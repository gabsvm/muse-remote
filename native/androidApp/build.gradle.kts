import org.jetbrains.kotlin.gradle.dsl.JvmTarget

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
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
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
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
}
