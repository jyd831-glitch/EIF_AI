using System.Text.RegularExpressions;
using EIF_AI.Models;

namespace EIF_AI.Services;

public sealed partial class TraceLogParser
{
    [GeneratedRegex(
        @"^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[(?<module>[^\]]+)\]\s+\[(?<signal>[^\]]+)\]\s+\((?<type>[^)]+)\)\s*:\s*(?<value>.*)$",
        RegexOptions.Compiled)]
    private static partial Regex HeaderRegex();

    [GeneratedRegex(@"^\[(?<k>[^\]]+)\]\s*:\s*(?<v>.*)$", RegexOptions.Compiled)]
    private static partial Regex FieldLineRegex();

    public IEnumerable<TimeFloorEvent> Parse(string filePath, bool includeBitOff = true)
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
            var signal = match.Groups["signal"].Value;
            var valueType = match.Groups["type"].Value;
            var value = match.Groups["value"].Value.Trim();
            var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var body = new List<string> { line };
            index++;

            if (string.Equals(valueType, "Structure", StringComparison.OrdinalIgnoreCase))
            {
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
                    var fieldMatch = FieldLineRegex().Match(next.Trim());
                    if (fieldMatch.Success)
                        fields[fieldMatch.Groups["k"].Value] = fieldMatch.Groups["v"].Value.Trim();

                    index++;
                }
            }

            var isBit = string.Equals(valueType, "Boolean", StringComparison.OrdinalIgnoreCase);
            if (!includeBitOff
                && isBit
                && string.Equals(value, "OFF", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            fields.TryGetValue("LOTID", out var lotId);
            var position = SequenceMapper.ExtractPosition(signal, fields);
            var isData = signal.Contains("_LW_DATA_", StringComparison.Ordinal);
            var (from, to) = SequenceMapper.TraceActors(signal);
            var friendly = SequenceMapper.FriendlySignalName(signal);
            var bitState = string.Equals(value, "ON", StringComparison.OrdinalIgnoreCase) ? "Bit On"
                : string.Equals(value, "OFF", StringComparison.OrdinalIgnoreCase) ? "Bit Off"
                : value;

            string label;
            string subLabel;
            if (isData)
            {
                label = $"{friendly} ( Word )";
                subLabel = SequenceMapper.BuildBitWordSubLabel(false, true);
            }
            else
            {
                // Match sample diagram wording: request OFF often shown as "Request Report"
                if (friendly.EndsWith("Request", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(value, "OFF", StringComparison.OrdinalIgnoreCase)
                    && !friendly.Contains("Confirm", StringComparison.OrdinalIgnoreCase))
                {
                    label = $"{friendly} Report ( {bitState} )";
                }
                else
                {
                    label = $"{friendly} ( {bitState} )";
                }

                subLabel = SequenceMapper.BuildBitWordSubLabel(true, false);
            }

            var direction = from == Actor.Plc ? "PLC->EIF" : "EIF->PLC";
            var raw = string.Join('\n', body);

            yield return new TimeFloorEvent
            {
                Id = $"trc-{seq++}-{headerLine}",
                Timestamp = DateTime.Parse(match.Groups["ts"].Value),
                Source = EventSource.Trace,
                Category = isData ? "TRACE-DATA" : "TRACE-BIT",
                Title = label,
                Direction = direction,
                Signal = signal,
                LotId = string.IsNullOrWhiteSpace(lotId) ? null : lotId,
                Position = position,
                Value = string.IsNullOrWhiteSpace(value) ? null : value,
                Level = match.Groups["level"].Value,
                From = from,
                To = to,
                Label = label,
                SubLabel = subLabel,
                HasBit = isBit,
                HasWord = isData,
                Fields = fields,
                IsAlarm = AlarmDetector.IsAlarm(fields, raw),
                RawSnippet = raw.Length > 4000 ? raw[..4000] + "…" : raw
            };
        }
    }
}
