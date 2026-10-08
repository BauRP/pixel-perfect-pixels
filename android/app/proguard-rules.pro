# Add project specific ProGuard rules here.

# Google AdMob & Play Services
-keep class com.google.android.gms.ads.** { *; }
-dontwarn com.google.android.gms.ads.**

# Capacitor Framework
-keep class com.getcapacitor.** { *; }

# Application Native Plugins & Code
-keep class app.lovable.privacygallery.** { *; }
