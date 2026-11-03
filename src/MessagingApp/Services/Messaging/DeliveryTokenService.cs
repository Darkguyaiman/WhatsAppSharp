using Microsoft.AspNetCore.DataProtection;

namespace MessagingApp.Services;

// Push receipts work with the app closed and never rely on the browser's current account cookie.
public sealed class DeliveryTokenService(IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("MessagingApp.PushDelivery.v1");
    public string Issue(int messageId, int userId) => protector.Protect($"{messageId}:{userId}:{DateTimeOffset.UtcNow.AddDays(1).ToUnixTimeSeconds()}");
    public bool TryRead(string? token, out int messageId, out int userId)
    {
        messageId=0;userId=0;
        if (string.IsNullOrEmpty(token) || token.Length>4096) return false;
        try
        {
            var parts=protector.Unprotect(token).Split(':');
            return parts.Length==3 && int.TryParse(parts[0],out messageId) && messageId>0 &&
                int.TryParse(parts[1],out userId) && userId>0 && long.TryParse(parts[2],out var expires) && expires>DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        }
        catch(Exception error) when(error is System.Security.Cryptography.CryptographicException or FormatException or ArgumentException) { return false; }
    }
}
