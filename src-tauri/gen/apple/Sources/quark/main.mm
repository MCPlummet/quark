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

// ─── Notification taps ───────────────────────────────────────────────────────
//
// tauri-plugin-notification owns the UNUserNotificationCenter delegate, and its
// didReceive deliberately ignores anything with a UNPushNotificationTrigger —
// it handles the local notifications it posted, nothing else. So a tap on a
// pushed notification arrives there and is dropped, and the app opens on
// whatever screen it was last on. This hook takes exactly the case the plugin
// declines: the two partition on the same trigger check, so neither ever sees
// the other's notifications.

// Where each hooked class keeps the implementation we displaced.
//
// A single global slot could not survive being pointed at two classes, and the
// delegate property is weak, so more than one is entirely reachable: a
// deallocated plugin manager empties the slot, the next foreground hooks the
// fallback delegate below instead, and a later plugin re-registration hooks a
// third. Each would overwrite the one saved implementation while the classes
// hooked before it still carried ours, so a response routed to an earlier one
// would call a later class's original with a mismatched `self`. Parking it on
// the class itself removes the shared slot, and inherits correctly for free.
//
// Registered by name rather than @selector: no class declares this, and
// -Wundeclared-selector would be right to say so.
static SEL quark_original_response_selector(void) {
    return sel_registerName("quark_original_userNotificationCenter:"
                            "didReceiveNotificationResponse:withCompletionHandler:");
}

static void quark_did_receive_response(id self, SEL _cmd, UNUserNotificationCenter *center,
                                       UNNotificationResponse *response, void (^completion)(void)) {
    UNNotificationRequest *request = response.notification.request;
    if ([request.trigger isKindOfClass:UNPushNotificationTrigger.class]) {
        id roomId = request.content.userInfo[@"room_id"];
        if ([roomId isKindOfClass:NSString.class] &&
            [response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
            ffi::quark_notification_tapped([(NSString *)roomId UTF8String]);
        }
    }
    // Whatever this class implemented before we took the selector over. Absent
    // on a class that had none — the fallback delegate below, or a plugin
    // delegate that never implemented the method — where completing is the
    // whole job.
    Method original = class_getInstanceMethod(object_getClass(self),
                                              quark_original_response_selector());
    if (original != NULL) {
        ((void (*)(id, SEL, UNUserNotificationCenter *, UNNotificationResponse *,
                   void (^)(void)))method_getImplementation(original))(
            self, _cmd, center, response, completion);
    } else {
        completion();
    }
}

// Fallback for the window where no plugin delegate exists yet. Only ever
// installed when the center has no delegate at hook time; the plugin assigning
// its own later simply replaces this, and the hook re-arms on the next
// foreground (see below).
@interface QuarkNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation QuarkNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completion {
    quark_did_receive_response(self, _cmd, center, response, completion);
}
@end

static void quark_install_response_hook(void) {
    static QuarkNotificationDelegate *fallback = nil;

    id<UNUserNotificationCenterDelegate> delegate =
        UNUserNotificationCenter.currentNotificationCenter.delegate;
    if (delegate == nil) {
        if (fallback == nil) {
            fallback = [QuarkNotificationDelegate new];
        }
        UNUserNotificationCenter.currentNotificationCenter.delegate = fallback;
        return;
    }
    if (delegate == fallback) {
        return; // Ours already.
    }

    Class cls = object_getClass(delegate);
    SEL sel = @selector(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:);
    if (class_getMethodImplementation(cls, sel) == (IMP)quark_did_receive_response) {
        // Idempotent — the re-arm below runs on every foreground. Also covers a
        // subclass of a class we already hooked, which inherits both halves.
        return;
    }

    Method method = class_getInstanceMethod(cls, sel);
    if (method == NULL) {
        class_addMethod(cls, sel, (IMP)quark_did_receive_response, "v@:@@@?");
        return;
    }

    // Park the original on *this* class, then take the selector over on this
    // class alone. Adding rather than replacing is what keeps an inherited
    // implementation inherited: method_setImplementation would rewrite the
    // superclass's method for every other subclass of it, while class_addMethod
    // overrides it here and nowhere else.
    const char *types = method_getTypeEncoding(method);
    class_addMethod(cls, quark_original_response_selector(),
                    method_getImplementation(method), types);
    if (!class_addMethod(cls, sel, (IMP)quark_did_receive_response, types)) {
        method_setImplementation(class_getInstanceMethod(cls, sel),
                                 (IMP)quark_did_receive_response);
    }
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
}

// Ask APNs for this device's token. Called from Rust, and only once push is
// on: registering here at launch minted a token — and handed the gateway an
// address — for installs that never opted in, and did it before the user had
// even logged in.
//
// Permission is not requested here either. It arrives from the frontend's
// notification init after login, where the user has just done something that
// explains the prompt; asking at launch put the system alert in front of the
// login screen and made that contextual request dead code. A token without
// permission is fine — it arrives, and nothing is displayed until they agree.
static void quark_request_apns_token(void) {
    // registerForRemoteNotifications is main-thread-only, and Rust calls this
    // from whichever runtime thread settled the pushers.
    dispatch_async(dispatch_get_main_queue(), ^{
        [UIApplication.sharedApplication registerForRemoteNotifications];
    });
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

// Remove every delivered notification belonging to a room, by the
// threadIdentifier the NSE stamps on pushed notifications. The registry-based
// removal in notify.rs cannot reach these: a pushed notification's identifier
// is assigned by the system in a process that was never ours.
static void quark_clear_room_delivered(const char *room_id) {
    if (room_id == NULL) {
        return;
    }
    NSString *room = [NSString stringWithUTF8String:room_id];
    if (room.length == 0) {
        return;
    }
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *delivered) {
        NSMutableArray<NSString *> *ids = [NSMutableArray array];
        for (UNNotification *notification in delivered) {
            if ([notification.request.content.threadIdentifier isEqualToString:room]) {
                [ids addObject:notification.request.identifier];
            }
        }
        if (ids.count > 0) {
            [center removeDeliveredNotificationsWithIdentifiers:ids];
        }
    }];
}

int main(int argc, char * argv[]) {
    @autoreleasepool {
        // Hand Rust the shared container and the one Foundation call it needs
        // inside it. Before start_app, so the first session to appear already
        // has somewhere to write the extension's credentials.
        ffi::quark_register_app_group(quark_app_group_path(),
                                      quark_protect_until_first_unlock);

        // And the call that clears a room's pushed notifications — same
        // direction, same reason: Rust naming an ObjC symbol breaks the
        // cdylib link that runs with no main.mm present.
        ffi::quark_register_notification_cleaner(quark_clear_room_delivered);

        // Likewise the call that asks APNs for a device token, which Rust makes
        // when push is enabled rather than unconditionally at launch.
        ffi::quark_register_token_requester(quark_request_apns_token);

        // Registered before start_app because start_app runs the run loop and
        // never returns. The observer fires once the delegate exists, which is
        // the earliest moment there is a class to add the callbacks to.
        [NSNotificationCenter.defaultCenter
            addObserverForName:UIApplicationDidFinishLaunchingNotification
                        object:nil
                         queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *note) {
                        quark_install_push_delegate();
                        quark_install_response_hook();
                    }];

        // The plugin assigns the center delegate whenever the webview first
        // touches the notification API, which can be after launch — and that
        // assignment silently discards the fallback delegate above. Re-arming
        // on every foreground keeps the hook installed whichever object
        // currently holds the delegate slot; the install is idempotent.
        [NSNotificationCenter.defaultCenter
            addObserverForName:UIApplicationDidBecomeActiveNotification
                        object:nil
                         queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *note) {
                        quark_install_response_hook();
                    }];

        ffi::start_app();
    }
    return 0;
}
