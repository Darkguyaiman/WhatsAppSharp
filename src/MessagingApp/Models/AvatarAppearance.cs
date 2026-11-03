using System.Globalization;
using System.Security;
using System.Security.Cryptography;
using System.Text;

namespace MessagingApp.Models;

public static class AvatarAppearance
{
    // Every background has at least 4.5:1 contrast with the white foreground.
    public static readonly string[] Colors = ["#075985", "#166534", "#6b21a8", "#9f1239", "#92400e", "#115e59", "#3730a3", "#7c2d12", "#334155", "#155e75"];
    public const string DefaultUrl = "/images/avatars/avatar-default.svg";
    public const string GroupPath = "M1 17.2c0-.57.15-1.09.44-1.56a2.9 2.9 0 0 1 1.16-1.09 13.76 13.76 0 0 1 9.65-1.16c1.07.26 2.12.64 3.15 1.16.48.25.87.61 1.16 1.09.3.47.44 1 .44 1.56v.8c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H3c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41v-.8ZM18.45 20a3.65 3.65 0 0 0 .55-2v-1a4 4 0 0 0-.61-2.11 5.4 5.4 0 0 0-1.74-1.74 12.61 12.61 0 0 1 4.5 1.4c.6.33 1.06.7 1.38 1.11.31.41.47.86.47 1.34v1c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59h-2.55ZM9 12a3.9 3.9 0 0 1-2.83-1.18A3.85 3.85 0 0 1 5 8c0-1.1.4-2.04 1.17-2.83A3.85 3.85 0 0 1 9 4c1.1 0 2.04.4 2.82 1.17A3.85 3.85 0 0 1 13 8c0 1.1-.4 2.04-1.18 2.82A3.85 3.85 0 0 1 9 12Zm10-4c0 1.1-.4 2.04-1.18 2.82a3.85 3.85 0 0 1-3.52 1.12 6.13 6.13 0 0 1-.7-.14A5.95 5.95 0 0 0 15 8a5.76 5.76 0 0 0-1.4-3.8c.23-.08.47-.14.7-.16.23-.03.47-.04.7-.04 1.1 0 2.04.4 2.82 1.17A3.85 3.85 0 0 1 19 8Z";

    public static string RandomColor() => Colors[RandomNumberGenerator.GetInt32(Colors.Length)];

    public static bool IsDefault(string? url) => string.IsNullOrWhiteSpace(url) || url is
        DefaultUrl or "/images/avatars/avatar-alex.svg" or "/images/avatars/avatar-sarah.svg" or
        "/images/avatars/avatar-john.svg" or "/images/avatars/avatar-emma.svg" or "/images/avatars/avatar-david.svg";

    public static string Initials(string? displayName)
    {
        var letters = new List<string>(2);
        var elements = StringInfo.GetTextElementEnumerator((displayName ?? "").Normalize());
        while (elements.MoveNext() && letters.Count < 2)
        {
            var element = elements.GetTextElement();
            if (element.EnumerateRunes().Any(Rune.IsLetter)) letters.Add(element);
        }
        return letters.Count == 0 ? "?" : string.Concat(letters).ToUpperInvariant();
    }

    public static string ForUser(User? user) => user != null && !IsDefault(user.AvatarUrl)
        ? user.AvatarUrl! : ForInitials(user?.DisplayName, user?.AvatarColor);

    public static string ForInitials(string? name, string? color) => Svg(color,
        $"<text x='24' y='24' dy='.35em' text-anchor='middle' fill='white' font-family='Segoe UI,Arial,sans-serif' font-size='18' font-weight='600'>{SecurityElement.Escape(Initials(name))}</text>");

    public static string ForGroup(string color) => Svg(color,
        $"<svg x='13' y='13' width='22' height='22' viewBox='0 0 24 24'><path fill='white' d='{GroupPath}'/></svg>");

    private static string Svg(string? color, string content)
    {
        var background = Colors.Contains(color) ? color : Colors[0];
        return "data:image/svg+xml;base64," + Convert.ToBase64String(Encoding.UTF8.GetBytes(
            $"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><circle cx='24' cy='24' r='24' fill='{background}'/>{content}</svg>"));
    }
}
