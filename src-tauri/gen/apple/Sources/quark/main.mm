#include "bindings/bindings.h"

#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

// ─── APNs device token ───────────────────────────────────────────────────────
//
// Tauri constructs the UIApplicationDelegate inside wry, so there is no
// compile-time place to put the remote-notification callbacks and no delegate
// class name to write a category against. They are added at runtime instead, to
// whichever class Tauri instantiated — the technique push SDKs use for exactly
// this problem.
//
// If the token never arrives, the class name logged below is the thing to start
// from: a category on that class is the documented fallback.

static void quark_did_register(id self, SEL _cmd, UIApplication *app, NSData *token) {
    // base64, not hex and not `[token description]`. Sygnal is left at its
    // default `convert_device_token_to_hex: true`, so it base64-*decodes* what
    // the pushkey carries; any other encoding registers cleanly and never
    // delivers.
    NSString *b64 = [token base64EncodedStringWithOptions:0];
    ffi::quark_apns_token(b64.UTF8String);
}

static void quark_did_fail(id self, SEL _cmd, UIApplication *app, NSError *error) {
    ffi::quark_apns_failed(error.localizedDescription.UTF8String);
}

static void quark_install_push_delegate(void) {
    UIApplication *app = UIApplication.sharedApplication;
    id delegate = app.delegate;
    if (delegate == nil) {
        NSLog(@"[quark] no app delegate yet; APNs callbacks not installed");
        return;
    }
    Class cls = object_getClass(delegate);
    NSLog(@"[quark] installing APNs callbacks on %@", NSStringFromClass(cls));

    SEL ok = @selector(application:didRegisterForRemoteNotificationsWithDeviceToken:);
    SEL bad = @selector(application:didFailToRegisterForRemoteNotificationsWithError:);

    // class_addMethod returns NO when the class already implements the
    // selector, in which case replace the implementation rather than leaving
    // ours unreachable.
    if (!class_addMethod(cls, ok, (IMP)quark_did_register, "v@:@@")) {
        method_setImplementation(class_getInstanceMethod(cls, ok), (IMP)quark_did_register);
    }
    if (!class_addMethod(cls, bad, (IMP)quark_did_fail, "v@:@@")) {
        method_setImplementation(class_getInstanceMethod(cls, bad), (IMP)quark_did_fail);
    }

    // UIApplication caches which delegate methods exist when the delegate is
    // assigned, so methods added afterwards can go uncalled. Re-assigning the
    // same object forces that cache to be rebuilt. Harmless if this UIKit does
    // not cache — and the first thing to suspect if the app misbehaves at
    // launch in a way that predates push.
    app.delegate = delegate;

    // A token arrives without permission, but nothing is displayed. Asking here
    // rather than at first-notification keeps the prompt next to the launch the
    // user just performed.
    [UNUserNotificationCenter.currentNotificationCenter
        requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                         UNAuthorizationOptionSound |
                                         UNAuthorizationOptionBadge)
                      completionHandler:^(BOOL granted, NSError *error) {
                          NSLog(@"[quark] notification permission granted=%d error=%@",
                                granted, error.localizedDescription);
                      }];

    [app registerForRemoteNotifications];
}

// ─── The app group shared with the notification service extension ────────────
//
// Both of these are *given* to Rust at startup rather than called from it. A
// Rust `extern "C"` block naming them would fail to link: the crate also builds
// as a cdylib, which links on its own with no main.mm in sight, and that link
// runs before the staticlib the app actually uses.

static const char *quark_app_group_path(void) {
    NSURL *url = [NSFileManager.defaultManager
        containerURLForSecurityApplicationGroupIdentifier:@"group.tel.quark.app"];
    if (url == nil) {
        return NULL; // Entitlement missing or not provisioned — a signing problem.
    }
    // Leaked deliberately: called once, at launch, and handing Rust a buffer
    // whose lifetime it would have to negotiate back across the boundary costs
    // more than the handful of bytes.
    return strdup(url.path.UTF8String);
}

// NSFileProtectionCompleteUntilFirstUserAuthentication: readable after the first
// unlock following a boot, *including* while the device is locked. The default
// class would make the extension fail precisely when pushes arrive — on a locked
// phone — and pass every hand test on an unlocked one.
static bool quark_protect_until_first_unlock(const char *path) {
    if (path == NULL) {
        return false;
    }
    NSString *p = [NSString stringWithUTF8String:path];
    NSError *err = nil;
    BOOL ok = [NSFileManager.defaultManager
        setAttributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication}
         ofItemAtPath:p
                error:&err];
    if (!ok) {
        NSLog(@"[quark] could not set file protection on %@: %@", p, err);
    }
    return ok;
}

int main(int argc, char * argv[]) {
    @autoreleasepool {
        // Hand Rust the shared container and the one Foundation call it needs
        // inside it. Before start_app, so the first session to appear already
        // has somewhere to write the extension's credentials.
        ffi::quark_register_app_group(quark_app_group_path(),
                                      quark_protect_until_first_unlock);

        // Registered before start_app because start_app runs the run loop and
        // never returns. The observer fires once the delegate exists, which is
        // the earliest moment there is a class to add the callbacks to.
        [NSNotificationCenter.defaultCenter
            addObserverForName:UIApplicationDidFinishLaunchingNotification
                        object:nil
                         queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *note) {
                        quark_install_push_delegate();
                    }];

        ffi::start_app();
    }
    return 0;
}
