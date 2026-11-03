using System.Text.Json;

namespace MessagingApp.Models;

public static class StatusStyle
{
    static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static string Normalize(string? styleJson)
    {
        var parsed = Parse(styleJson);
        return JsonSerializer.Serialize(parsed, JsonOptions);
    }

    public static object Parse(string? styleJson)
    {
        var imageScale = 100;
        var align = "center";
        var size = "md";
        var bold = false;
        var italic = false;
        if (!string.IsNullOrWhiteSpace(styleJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(styleJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("imageScale", out var scaleEl) && scaleEl.TryGetInt32(out var scale))
                    imageScale = Math.Clamp(scale, 50, 150);
                if (root.TryGetProperty("align", out var alignEl) && alignEl.GetString() is { } a && a is "left" or "center" or "right")
                    align = a;
                if (root.TryGetProperty("size", out var sizeEl) && sizeEl.GetString() is { } z && z is "sm" or "md" or "lg" or "xl")
                    size = z;
                if (root.TryGetProperty("bold", out var boldEl))
                    bold = boldEl.ValueKind == JsonValueKind.True;
                if (root.TryGetProperty("italic", out var italicEl))
                    italic = italicEl.ValueKind == JsonValueKind.True;
            }
            catch (JsonException) { /* Keep defaults for corrupt or legacy values. */ }
        }
        return new { imageScale, align, size, bold, italic };
    }
}
