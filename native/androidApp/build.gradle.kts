import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// A single QA key lives in GitHub Secrets, never in source control.
// Without that key local builds use Android's ordinary per-machine debug key.
val qaKeystorePath = providers.environmentVariable("MUSE_QA_KEYSTORE_PATH").orNull
val qaStorePassword = providers.environmentVariable("MUSE_QA_STORE_PASSWORD").orNull
val hasQaSigning = !qaKeystorePath.isNullOrBlank() && !qaStorePassword.isNullOrBlank()

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    compilerOptions.jvmTarget = JvmTarget.JVM_17
}

android {
    namespace = "io.muse.remote.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "io.muse.remote"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.environmentVariable("GITHUB_RUN_NUMBER").orNull
            ?.toIntOrNull()?.let { maxOf(it + 1, 85) } ?: 85
        versionName = "0.2.0-beta.8"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    signingConfigs {
        if (hasQaSigning) {
            create("museQa") {
                storeFile = file(qaKeystorePath!!)
                storePassword = qaStorePassword
                keyAlias = "museqa"
                keyPassword = qaStorePassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            if (hasQaSigning) signingConfig = signingConfigs.getByName("museQa")
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}
dependencies {
    implementation(project(":shared"))
    implementation(libs.androidx.activity.compose)
    implementation(compose.material3)
    // MainActivity directly constructs the Ktor engine/client.
    // Dependencies in :shared are implementation-scoped, so they are not
    // exposed on :androidApp's Kotlin compile classpath.
    implementation(libs.kotlinx.coroutines)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.google.code.scanner)
}
