plugins {
    alias(libs.plugins.kotlinJvm)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
    implementation(libs.ktor.client.cio)
}

kotlin { jvmToolchain(21) }

compose.desktop {
    application {
        mainClass = "io.muse.remote.desktop.MainKt"
    }
}
