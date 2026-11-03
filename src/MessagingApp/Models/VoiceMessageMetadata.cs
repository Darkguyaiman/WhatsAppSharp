using System.Text.Json;
using System.Text.Json.Serialization;

namespace MessagingApp.Models;

// Stored in the existing Content column; audio stays in attachment storage.
public sealed class VoiceMessageMetadata
{
    [JsonPropertyName("wa")] public string Kind { get; init; } = "voice";
    [JsonPropertyName("duration")] public double Duration { get; init; }
    [JsonPropertyName("waveform")] public double[] Waveform { get; init; } = [];

    public static bool TryParse(string? content, out VoiceMessageMetadata? metadata)
    {
        metadata = null;
        if (string.IsNullOrWhiteSpace(content) || content.Length > 5000) return false;
        try
        {
            var value = JsonSerializer.Deserialize<VoiceMessageMetadata>(content, new JsonSerializerOptions { MaxDepth = 4 });
            if (value is null || value.Kind != "voice" || !double.IsFinite(value.Duration) ||
                value.Duration < 0.5 || value.Duration > 600 || value.Waveform is null ||
                value.Waveform.Length is < 1 or > 64 || value.Waveform.Any(n => !double.IsFinite(n) || n < 0 || n > 1))
                return false;
            metadata = value;
            return true;
        }
        catch (JsonException) { return false; }
    }

    public static bool IsAudioPath(string? path) => path is not null &&
        new[] { ".webm", ".ogg", ".m4a", ".mp4", ".mp3", ".wav" }.Contains(Path.GetExtension(path).ToLowerInvariant());
}
