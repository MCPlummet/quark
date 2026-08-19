buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        // Pinned between two hard limits, so this is narrower than it looks.
        //
        // Floor: org.unifiedpush.android:connector ships Kotlin 2.1.0 metadata,
        // which Tauri's template default of 1.9.25 cannot read at all (a 1.9
        // compiler reads metadata only up to 2.0.0).
        //
        // Ceiling: Tauri's own Android Gradle modules — vendored read-only in
        // ~/.cargo/registry, so unpatchable — still use `kotlinOptions`, which
        // Kotlin removed. Anything from 2.2 up fails inside Tauri's own build
        // file before reaching our code.
        //
        // 2.1.x is the only band satisfying both. Revisit when Tauri migrates
        // its Gradle files to the compilerOptions DSL.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }

    // The UnifiedPush connector depends on a much newer kotlin-stdlib than the
    // compiler above can read, and Gradle resolves to the highest requested
    // version — so without this the stdlib alone reintroduces the metadata
    // error the Kotlin pin exists to avoid. Held at the compiler's own version,
    // which is what every other module already expects.
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            if (requested.group == "org.jetbrains.kotlin" &&
                requested.name.startsWith("kotlin-stdlib")
            ) {
                useVersion("2.1.0")
                because("must stay readable by the Kotlin compiler pinned above")
            }
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

