using System.Globalization;
using System.Text;

namespace MessagingApp.Models;

public static class EmojiReaction
{
    public static bool IsValid(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 64 || new StringInfo(value).LengthInTextElements != 1) return false;
        var hasEmoji = false;
        foreach (var rune in value.EnumerateRunes())
        {
            var n = rune.Value;
            if (n is >= 0x1F000 and <= 0x1FAFF or >= 0x2300 and <= 0x27FF or >= 0x2B00 and <= 0x2BFF or >= 0x2190 and <= 0x21FF or >= 0x2900 and <= 0x297F or 0x3030 or 0x303D or 0x3297 or 0x3299 or 0x00A9 or 0x00AE or 0x203C or 0x2049 or 0x2122 or 0x2139 or 0x20E3)
                hasEmoji = true;
            else if (n is not (0x200D or 0xFE0F or 0xFE0E or 0x23 or 0x2A) && n is not (>= 0x30 and <= 0x39) && n is not (>= 0xE0020 and <= 0xE007F))
                return false;
        }
        return hasEmoji;
    }
}
