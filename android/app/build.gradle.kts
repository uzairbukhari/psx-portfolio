import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.detekt)
    alias(libs.plugins.ktlint)
}

// Version comes from the release tag (android-v1.4.0 -> -PversionName=1.4.0 [-PrcNumber=2]); local builds get 0.0.1-dev.
val versionNameValue = providers.gradleProperty("versionName").orElse("0.0.1-dev").get()
val rcNumber = providers.gradleProperty("rcNumber").map(String::toInt).orElse(0).get()
val versionBase = Properties().apply { file("../version.properties").inputStream().use(::load) }.getProperty("VERSION_CODE_BASE").toInt()

fun versionCodeFor(
    name: String,
    rc: Int,
): Int {
    val core = name.substringBefore('-').split('.').map(String::toInt)
    if (core.size != 3) return 1
    val (major, minor, patch) = core
    // An rc sits below the final release of the same version: final = x10 + 9, rc n = x10 + (n - 1) up to 8.
    val slot = if (rc > 0) (rc - 1).coerceAtMost(8) else 9
    return versionBase + major * 100_000 + minor * 1_000 + patch * 10 + slot
}

/** Signing material comes from the environment (decoded from GitHub Secrets by the release workflow), never from git. */
fun signingEnv(
    flavor: String,
    key: String,
): String? = System.getenv("SIPWISE_${flavor.uppercase()}_$key")

android {
    namespace = "app.sipwise"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.uzairbukhari.sipwise"
        minSdk = 26
        targetSdk = 36
        versionName = versionNameValue
        versionCode = if (versionNameValue == "0.0.1-dev") 1 else versionCodeFor(versionNameValue, rcNumber)
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"50195098198-7mas6ulcfrkarsg088lk6l6evt5dh6sf.apps.googleusercontent.com\"")
        buildConfigField("String", "UPDATE_REPO", "\"uzairbukhari/psx-portfolio\"")
        buildConfigField("String", "TAG_PREFIX", "\"android-v\"")
    }

    flavorDimensions += "env"
    productFlavors {
        create("staging") {
            dimension = "env"
            applicationIdSuffix = ".staging"
            resValue("string", "app_name", "Sipwise Staging")
            buildConfigField("String", "API_BASE_URL", "\"https://psx-portfolio-sip-staging.suzairbukhari.workers.dev\"")
            buildConfigField("boolean", "INCLUDE_PRERELEASES", "true")
        }
        create("production") {
            dimension = "env"
            resValue("string", "app_name", "Sipwise")
            val api = providers.gradleProperty("apiBaseUrl").orElse("").get()
            buildConfigField("String", "API_BASE_URL", "\"$api\"")
            buildConfigField("boolean", "INCLUDE_PRERELEASES", "false")
        }
    }

    signingConfigs {
        for (flavor in listOf("staging", "production")) {
            val file = signingEnv(flavor, "KEYSTORE_FILE")
            if (file != null) {
                create(flavor) {
                    storeFile = file(file)
                    storePassword = signingEnv(flavor, "KEYSTORE_PASSWORD")
                    keyAlias = signingEnv(flavor, "KEY_ALIAS")
                    keyPassword = signingEnv(flavor, "KEY_PASSWORD")
                }
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    productFlavors.configureEach { signingConfigs.findByName(name)?.let { signingConfig = it } }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    lint {
        warningsAsErrors = true
        abortOnError = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(project(":core:designsystem"))
    implementation(project(":core:model"))
    implementation(project(":core:vault"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test>().configureEach { useJUnitPlatform() }

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootProject.file("config/detekt.yml"))
}
