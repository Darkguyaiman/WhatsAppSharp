using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using QRCoder;

namespace MessagingApp.Services;

/// <summary>
/// Public contact codes. A scanned value is only ever turned into a username;
/// the app does not navigate to the URL encoded in a QR code.
/// </summary>
public static class ContactCodes
{
    const string CompactPrefix = "MSGAPP1:";
    static readonly System.Text.RegularExpressions.Regex UsernamePattern = new(
        @"^[a-z0-9_.-]{1,50}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    public static string Link(HttpRequest request, string username) =>
        Link($"{request.Scheme}://{request.Host}{request.PathBase}", username);

    public static string Link(string origin, string username)
    {
        var normalized = NormalizeUsername(username) ?? throw new ArgumentException("Username is not valid.", nameof(username));
        return $"{origin.TrimEnd('/')}/Chat?contact={Uri.EscapeDataString(normalized)}";
    }

    public static string? NormalizeUsername(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var username = Uri.UnescapeDataString(value).Trim().TrimStart('@').ToLowerInvariant();
        return UsernamePattern.IsMatch(username) ? username : null;
    }

    public static string? UsernameFrom(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var text = raw.Trim();
        if (text.StartsWith(CompactPrefix, StringComparison.OrdinalIgnoreCase))
            return NormalizeUsername(text[CompactPrefix.Length..]);
        return TryReadContactQuery(text, out var contact) ? NormalizeUsername(contact) : null;
    }

    public static string ToSvg(string payload)
    {
        using var generator = new QRCodeGenerator();
        var data = generator.CreateQrCode(payload, QRCodeGenerator.ECCLevel.Q);
        using var svg = new SvgQRCode(data);
        return svg.GetGraphic(8, "#111b21", "#ffffff", true);
    }

    static bool TryReadContactQuery(string text, out string contact)
    {
        contact = "";
        Uri? uri = null;
        if (Uri.TryCreate(text, UriKind.Absolute, out var absolute)) uri = absolute;
        else if (text.StartsWith('/') && Uri.TryCreate("https://contacts.invalid" + text, UriKind.Absolute, out var relative)) uri = relative;
        if (uri == null || !uri.AbsolutePath.TrimEnd('/').Equals("/Chat", StringComparison.OrdinalIgnoreCase)) return false;
        if (!QueryHelpers.ParseQuery(uri.Query).TryGetValue("contact", out var values)) return false;
        contact = values.ToString();
        return contact.Length > 0;
    }
}
