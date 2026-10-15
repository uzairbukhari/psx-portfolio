# kotlinx.serialization keeps its generated serializers through its own consumer rules.
# Bouncy Castle is used only for Argon2id; keep the generator and parameter classes (reflection-free, but cheap insurance).
-keep class org.bouncycastle.crypto.generators.Argon2BytesGenerator { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters { *; }
-dontwarn org.bouncycastle.**
