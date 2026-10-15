pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "sipwise-android"

// Pure Kotlin/JVM modules: built and tested without the Android SDK.
include(":core:model")
include(":core:vault")

// Android modules need the Android SDK (CI, a developer machine). Without one, Gradle still runs the JVM modules above.
val hasAndroidSdk = listOf("ANDROID_HOME", "ANDROID_SDK_ROOT").any { !System.getenv(it).isNullOrBlank() } ||
    file("local.properties").exists()
if (hasAndroidSdk) {
    include(":core:designsystem")
    include(":app")
}
