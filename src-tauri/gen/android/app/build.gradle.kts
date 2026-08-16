import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing. Values come from a local `keystore.properties` (git-ignored,
// for manual local release builds) or, in CI, from environment variables. The
// keystore MUST be the same one for every release forever — Android refuses to
// upgrade an installed app whose signing certificate differs, so a new key
// would force every user to uninstall+reinstall. See keystore.properties.example.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
fun signingValue(propKey: String, envKey: String): String? =
    keystoreProperties.getProperty(propKey) ?: System.getenv(envKey)

android {
    compileSdk = 36
    namespace = "tel.quark.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "tel.quark.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            val storeFilePath = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
            if (storeFilePath != null) {
                storeFile = file(storeFilePath)
                storePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
                // v1 (JAR) + v2 (APK Signature Scheme) for the widest device range.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // Attach the release signing config only when a keystore is actually
            // configured; otherwise leave the APK unsigned so the CI debug-signed
            // fallback path still works for dev sideloading.
            signingConfigs.getByName("release").storeFile?.let {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    buildFeatures {
        buildConfig = true
    }
}

// Kotlin 2.x removed `android { kotlinOptions { jvmTarget = "..." } }`. Same
// target as before (1.8) so the bytecode level and desugaring behaviour are
// unchanged — this is a DSL migration, not a toolchain change. It has to stay
// aligned with AGP's Java sourceCompatibility, which also defaults to 8.
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    // UnifiedPush: the user's chosen distributor (ntfy, Conversations, …) wakes
    // the app; a gateway translates Matrix push into a POST to it. No Google
    // Play Services, which is the point — Quark ships through its own F-Droid
    // repo. The library's own manifest supplies the <queries> block that makes
    // distributors visible under Android 11+ package visibility.
    implementation("org.unifiedpush.android:connector:3.3.3")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")