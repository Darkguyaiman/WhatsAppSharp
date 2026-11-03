using System.Text.Json;

namespace MessagingApp.Services;

public static class GoogleProfile
{
    // ASP.NET Core uses Google's v3 userinfo endpoint, which returns email_verified.
    public static bool HasVerifiedEmail(JsonElement profile) =>
        profile.TryGetProperty("email_verified", out var verified) && verified.ValueKind == JsonValueKind.True;
}
