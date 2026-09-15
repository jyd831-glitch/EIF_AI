using System.Text.RegularExpressions;
using EIF_AI.Models;

namespace EIF_AI.Services;

public sealed partial class SfcLogParser
{
    [GeneratedRegex(
        @"^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[(?<module>[^\]]+)\]\s+\[(?<dir>[^\]]+)\]\s+(?<msgtype>[\w.]+)\s*:",
        RegexOptions.Compiled)]
    private static partial Regex HeaderRegex();

    [GeneratedRegex(@"<(?<k>[A-Z0-9_]+)=(?<v>[^>]*)>", RegexOptions.Compiled)]
    private static partial Regex FieldRegex();

    [GeneratedRegex(@"<NAME=(?<n>[^>]+)>\s*\r?\n\s*<VALUE=(?<v>[^>]*)>", RegexOptions.Compiled)]
    private static partial Regex NameValueRegex();

    public IEnumerable<TimeFloorEvent> Parse(string filePath)
    {
        var lines = File.ReadAllLines(filePath);
        var index = 0;
        var seq = 0;

        while (index < lines.Length)
        {
            var line = lines[index];
            if (string.IsNullOrWhiteSpace(line))
            {
                index++;
                continue;
            }

            var match = HeaderRegex().Match(line);
            if (!match.Success)
            {
                index++;
                continue;
            }

            var headerLine = index;
            var body = new List<string> { line };
            index++;

            while (index < lines.Length)
            {
                var next = lines[index];
                if (string.IsNullOrWhiteSpace(next))
                {
                    index++;
                    break;
                }

                if (HeaderRegex().IsMatch(next))
                    break;

                body.Add(next);
                index++;
            }

            var raw = string.Join('\n', body);
            var fields = ExtractFields(raw);
            fields.TryGetValue("LOTID", out var lotId);
            fields.TryGetValue("POSITION", out var position);
            fields.TryGetValue("PROCID", out var procId);
            fields.TryGetValue("MSGID", out var msgId);
            fields.TryGetValue("ACK", out var ack);

            var msgType = match.Groups["msgtype"].Value;
            var direction = match.Groups["dir"].Value;
            var shortType = msgType.Replace("DYNAMIC.EVENT.", "", StringComparison.Ordinal);
            var actors = SequenceMapper.SfcActors(direction);

            string label;
            string? subLabel = null;
            if (!string.IsNullOrWhiteSpace(msgId))
            {
                label = $"MESSAGE ID : {msgId}";
                subLabel = shortType;
            }
            else if (msgType.Contains("RESPONSE", StringComparison.OrdinalIgnoreCase))
            {
                // RESPONSE ACK is noise on TimeFloor — skip
                continue;
            }
            else
            {
                label = shortType;
            }

            yield return new TimeFloorEvent
            {
                Id = $"sfc-{seq++}-{headerLine}",
                Timestamp = DateTime.Parse(match.Groups["ts"].Value),
                Source = EventSource.Sfc,
                Category = "SFC",
                Title = label,
                Direction = direction,
                MessageType = msgType,
                LotId = string.IsNullOrWhiteSpace(lotId) ? null : lotId,
                Position = string.IsNullOrWhiteSpace(position) ? null : position,
                ProcId = string.IsNullOrWhiteSpace(procId) ? null : procId,
                MsgId = string.IsNullOrWhiteSpace(msgId) ? null : msgId,
                Level = match.Groups["level"].Value,
                From = actors?.From,
                To = actors?.To,
                Label = label,
                SubLabel = subLabel,
                Fields = fields,
                IsAlarm = AlarmDetector.IsAlarm(fields, raw),
                RawSnippet = raw.Length > 4000 ? raw[..4000] + "…" : raw
            };
        }
    }

    private static Dictionary<string, string> ExtractFields(string raw)
    {
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match m in FieldRegex().Matches(raw))
        {
            var key = m.Groups["k"].Value;
            var value = m.Groups["v"].Value;
            if (key is "NAME" or "VALUE")
                continue;
            fields[key] = value;
        }

        foreach (Match m in NameValueRegex().Matches(raw))
            fields[m.Groups["n"].Value] = m.Groups["v"].Value;

        return fields;
    }
}
