using System.Globalization;
using System.Text.RegularExpressions;
using EIF_AI.Models;

namespace EIF_AI.Services;

public static partial class SequenceMapper
{
    [GeneratedRegex(@"_(\d{2})$", RegexOptions.Compiled)]
    private static partial Regex PositionSuffixRegex();

    public static IReadOnlyList<SequenceMessage> ToMessages(IReadOnlyList<TimeFloorEvent> events)
    {
        var ordered = events.OrderBy(e => e.Timestamp).ThenBy(e => e.Id).ToList();
        var messages = new List<SequenceMessage>();

        for (var i = 0; i < ordered.Count; i++)
        {
            var ev = ordered[i];

            if (ev.Source == EventSource.Trace && ev.Category == "TRACE-DATA")
                continue;

            if (ev.From is null || ev.To is null || string.IsNullOrWhiteSpace(ev.Label))
                continue;

            var hasWord = ev.HasWord;
            var sub = ev.SubLabel;
            TimeFloorEvent? word = null;

            if (ev.Source == EventSource.Trace && ev.Category == "TRACE-BIT")
            {
                word = FindMatchingWord(ordered, i, ev);
                if (word is not null)
                {
                    hasWord = true;
                    sub = BuildBitWordSubLabel(true, true);
                }
            }

            if (ev.Source == EventSource.Trace && string.IsNullOrWhiteSpace(sub))
                sub = BuildBitWordSubLabel(ev.HasBit || ev.Category == "TRACE-BIT", hasWord);

            var isAlarm = ev.IsAlarm
                || AlarmDetector.IsAlarm(ev.Fields, ev.RawSnippet)
                || (word is not null && (word.IsAlarm || AlarmDetector.IsAlarm(word.Fields, word.RawSnippet)));

            messages.Add(new SequenceMessage
            {
                Id = ev.Id,
                Timestamp = ev.Timestamp,
                From = ev.From.Value,
                To = ev.To.Value,
                Label = ev.Label!,
                SubLabel = sub,
                LotId = ev.LotId ?? word?.LotId,
                Position = ev.Position ?? word?.Position,
                Source = ev.Source,
                Signal = ev.Signal,
                Value = ev.Value,
                RawSnippet = ev.RawSnippet,
                IsAlarm = isAlarm,
                Fields = ev.Fields,
                WordSignal = word?.Signal,
                WordTimestamp = word?.Timestamp,
                WordRawSnippet = word?.RawSnippet,
                WordFields = word?.Fields is { Count: > 0 } ? word.Fields : null
            });
        }

        return messages;
    }

    private static TimeFloorEvent? FindMatchingWord(List<TimeFloorEvent> ordered, int index, TimeFloorEvent bit)
    {
        var family = GetSignalFamily(bit.Signal);
        if (string.IsNullOrEmpty(family))
            return null;

        // Prefer nearby DATA with same family (including position suffix _01/_02)
        TimeFloorEvent? best = null;
        var bestDelta = double.MaxValue;

        var from = Math.Max(0, index - 4);
        var to = Math.Min(ordered.Count - 1, index + 6);
        for (var j = from; j <= to; j++)
        {
            var w = ordered[j];
            if (w.Category != "TRACE-DATA")
                continue;
            if (!string.Equals(GetSignalFamily(w.Signal), family, StringComparison.OrdinalIgnoreCase))
                continue;

            var delta = Math.Abs((w.Timestamp - bit.Timestamp).TotalSeconds);
            if (delta > 2.0)
                continue;

            if (delta < bestDelta)
            {
                bestDelta = delta;
                best = w;
            }
        }

        return best;
    }

    public static string FriendlySignalName(string signal)
    {
        var name = signal
            .Replace("I_LB_EVENT_", "", StringComparison.Ordinal)
            .Replace("O_LB_EVENT_", "", StringComparison.Ordinal)
            .Replace("I_LW_DATA_", "", StringComparison.Ordinal)
            .Replace("O_LW_DATA_", "", StringComparison.Ordinal);

        name = PositionSuffixRegex().Replace(name, "");
        name = name.Replace('_', ' ');
        return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(name.ToLowerInvariant());
    }

    public static string? ExtractPosition(string? signal, Dictionary<string, string> fields)
    {
        if (fields.TryGetValue("POSITION", out var pos) && !string.IsNullOrWhiteSpace(pos))
            return pos;

        if (signal is null) return null;
        var m = PositionSuffixRegex().Match(signal);
        return m.Success ? m.Groups[1].Value.TrimStart('0').Length == 0 ? "0" : m.Groups[1].Value.TrimStart('0') : null;
    }

    public static string GetSignalBase(string? signal)
    {
        return PositionSuffixRegex().Replace(GetSignalFamily(signal), "");
    }

    /// <summary>
    /// LOT_INFO_REQUEST_02 — keeps position suffix, strips I/O bit/word prefixes.
    /// </summary>
    public static string GetSignalFamily(string? signal)
    {
        if (string.IsNullOrEmpty(signal)) return "";
        return signal
            .Replace("I_LB_EVENT_", "", StringComparison.Ordinal)
            .Replace("O_LB_EVENT_", "", StringComparison.Ordinal)
            .Replace("I_LW_DATA_", "", StringComparison.Ordinal)
            .Replace("O_LW_DATA_", "", StringComparison.Ordinal);
    }

    public static string BuildBitWordSubLabel(bool hasBit, bool hasWord)
    {
        if (hasBit && hasWord) return "/ B : + W :";
        if (hasBit) return "/ B :";
        if (hasWord) return "/ W :";
        return "";
    }

    public static (Actor From, Actor To) TraceActors(string signal)
    {
        var fromPlc = signal.StartsWith("I_", StringComparison.Ordinal);
        return fromPlc ? (Actor.Plc, Actor.Eif) : (Actor.Eif, Actor.Plc);
    }

    public static (Actor From, Actor To)? SfcActors(string? direction)
    {
        if (string.IsNullOrWhiteSpace(direction)) return null;
        if (direction.Contains("EQP->MES", StringComparison.OrdinalIgnoreCase)
            || direction.Contains("EIF->MES", StringComparison.OrdinalIgnoreCase))
            return (Actor.Eif, Actor.Mes);
        if (direction.Contains("MES->EQP", StringComparison.OrdinalIgnoreCase)
            || direction.Contains("MES->EIF", StringComparison.OrdinalIgnoreCase))
            return (Actor.Mes, Actor.Eif);
        return null;
    }
}
