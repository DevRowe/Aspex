plugins {
    // AGP 9 ships built-in Kotlin support; the standalone
    // org.jetbrains.kotlin.android plugin must not be applied.
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "dev.aspex.glimmerlab"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.aspex.glimmerlab"
        // Projected's ProjectedContext APIs require API 35, and DP4 phone
        // AVDs are API 36+. No reason to support older hosts in a lab client.
        minSdk = 35
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "ASPEX_HUB_URL", "\"${providers.gradleProperty("aspexHubUrl").getOrElse("http://10.0.2.2:4317")}\"")
        buildConfigField("String", "ASPEX_HUB_TOKEN", "\"${providers.gradleProperty("aspexHubToken").getOrElse("")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    kotlin {
        jvmToolchain(21)
    }
}

dependencies {
    val composeBom = platform(libs.androidx.compose.bom)
    implementation(composeBom)

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.xr.glimmer)
    implementation(libs.xr.projected)
    implementation(libs.xr.runtime)

    testImplementation(libs.junit)
}
