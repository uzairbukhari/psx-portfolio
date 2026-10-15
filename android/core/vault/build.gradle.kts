plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.detekt)
    alias(libs.plugins.ktlint)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    api(libs.kotlinx.serialization.json)
    // Argon2id (RFC 9106). Same classes the RN app's native module uses; the platform's own copy is hidden from apps.
    implementation(libs.bouncycastle.bcprov)
    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The shared on-wire vector written by the TypeScript tests (tests/fixtures/vault-vector.json).
    systemProperty("sipwise.vectorFile", rootProject.projectDir.resolve("../tests/fixtures/vault-vector.json").canonicalPath)
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootProject.file("config/detekt.yml"))
}
