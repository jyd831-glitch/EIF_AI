using System.Text.RegularExpressions;

namespace EIF_AI.Services;

/// <summary>
/// RESULT=2 / RESULT=NG / LINESTOP=1 → alarm (red bold arrow on TimeFloor).
/// </summary>
public static partial class AlarmDetector
{
    [GeneratedRegex(
        @"(?:\\?""RESULT\\?""\s*:\s*\\?""?(?<r>2|NG)\\?""?)|(?:<RESULT>\s*(?<r>2|NG)\s*</RESULT>)|(?:\[RESULT\]\s*:\s*(?<r>2|NG)\b)|(?:RESULT\s*[=:]\s*(?<r>2|NG)\b)|(?:<NAME\s*=\s*RESULT>\s*<VALUE\s*=\s*(?<r>2|NG)>)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex ResultAlarmRegex();

    [GeneratedRegex(
        @"(?:\\?""LINESTOP\\?""\s*:\s*\\?""?(?<v>1)\\?""?)|(?:<LINESTOP>\s*(?<v>1)\s*</LINESTOP>)|(?:\[LINESTOP\]\s*:\s*(?<v>1)\b)|(?:LINESTOP\s*[=:]\s*(?<v>1)\b)|(?:<NAME\s*=\s*LINESTOP>\s*<VALUE\s*=\s*(?<v>1)>)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex LineStopAlarmRegex();

    public static bool IsAlarm(IReadOnlyDictionary<string, string>? fields, string? raw = null)
    {
        if (fields is not null)
        {
            foreach (var (key, value) in fields)
            {
                if (key.Equals("RESULT", StringComparison.OrdinalIgnoreCase) && IsBadResult(value))
                    return true;
                if (key.Equals("LINESTOP", StringComparison.OrdinalIgnoreCase) && IsLineStopOn(value))
                    return true;
            }
        }

        if (string.IsNullOrWhiteSpace(raw))
            return false;

        return ResultAlarmRegex().IsMatch(raw) || LineStopAlarmRegex().IsMatch(raw);
    }

    public static bool IsBadResult(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var v = value.Trim().Trim('"', '\'');
        return v.Equals("2", StringComparison.OrdinalIgnoreCase)
               || v.Equals("NG", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsLineStopOn(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        return value.Trim().Trim('"', '\'').Equals("1", StringComparison.OrdinalIgnoreCase);
    }
}
