plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.detekt)
    alias(libs.plugins.ktlint)
}

android {
    namespace = "app.sipwise.engine"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        warningsAsErrors = true
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable")
    }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    api(project(":core:session"))
    implementation(libs.androidx.javascriptengine)
    implementation(libs.kotlinx.coroutines.guava)
}

// The shared TypeScript (lib/ and the phone's pure view-model code) is bundled into one script the app ships as an
// asset. The script is generated, never committed: every build makes it from the sources it will be tested against.
val engineDir = rootProject.file("engine")
val buildEngineBundle by tasks.registering(Exec::class) {
    group = "build"
    description = "Bundles lib/ into core/engine/src/main/assets/engine.js"
    workingDir = engineDir
    commandLine("sh", "-c", "npm ci --no-audit --no-fund && node build.mjs")
    inputs.dir(engineDir.resolve("src"))
    inputs.files(engineDir.resolve("package-lock.json"), engineDir.resolve("build.mjs"))
    inputs.dir(rootProject.file("../lib"))
    inputs.dir(rootProject.file("../mobile/src/data"))
    outputs.file(layout.projectDirectory.file("src/main/assets/engine.js"))
}

tasks.named("preBuild") { dependsOn(buildEngineBundle) }

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootProject.file("config/detekt.yml"))
}
