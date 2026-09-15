using System.Text.RegularExpressions;
using System.Xml.Linq;
using EIF_AI.Models;

namespace EIF_AI.Services;

/// <summary>
/// Parses PC-type TRACE logs with [RECV(ASC)] / [SEND(ASC)] EIF XML messages.
/// </summary>
public sealed partial class PcTraceLogParser
{
    [GeneratedRegex(
        @"^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[[^\]]*\]\s+\[(?<dir>RECV|SEND)\(ASC\)\]\s*:\s*(?<rest>.*)$",
        RegexOptions.Compiled)]
    private static partial Regex HeaderRegex();

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[", RegexOptions.Compiled)]
    private static partial Regex TimestampStartRegex();

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
            var dir = match.Groups["dir"].Value;
            var body = new List<string>();
            var rest = match.Groups["rest"].Value;
            if (!string.IsNullOrWhiteSpace(rest))
                body.Add(rest);

            index++;
            while (index < lines.Length)
            {
                var next = lines[index];
                if (TimestampStartRegex().IsMatch(next))
                    break;

                body.Add(next);
                index++;
            }

            var xmlText = string.Join('\n', body).Trim();
            if (string.IsNullOrWhiteSpace(xmlText) || !xmlText.Contains("<EIF", StringComparison.OrdinalIgnoreCase))
                continue;

            string? eifId = null;
            string? eifName = null;
            string? lotId = null;
            string? procId = null;
            string? eqpId = null;
            var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["DIR"] = dir
            };

            try
            {
                var doc = XDocument.Parse(xmlText);
                var root = doc.Root;
                if (root is not null)
                {
                    eifId = (string?)root.Attribute("ID");
                    eifName = (string?)root.Attribute("NAME");
                    if (!string.IsNullOrWhiteSpace(eifId)) fields["ID"] = eifId;
                    if (!string.IsNullOrWhiteSpace(eifName)) fields["NAME"] = eifName;

                    foreach (var el in root.Descendants())
                    {
                        var name = el.Name.LocalName.ToUpperInvariant();
                        var val = (el.Value ?? "").Trim();
                        if (string.IsNullOrEmpty(val)) continue;

                        switch (name)
                        {
                            case "SETID":
                                lotId = val;
                                fields["SETID"] = val;
                                break;
                            case "PROCID":
                                procId = val;
                                fields["PROCID"] = val;
                                break;
                            case "EQPID":
                                eqpId = val;
                                fields["EQPID"] = val;
                                break;
                            case "WOID":
                            case "ORGID":
                            case "LINEID":
                            case "ACK":
                            case "REASON":
                            case "TID":
                            case "RESULT":
                            case "LINESTOP":
                                fields[name] = val;
                                break;
                        }
                    }
                }
            }
            catch
            {
                // Fallback attribute scrape if XML is malformed
                var idM = Regex.Match(xmlText, @"ID\s*=\s*""([^""]+)""", RegexOptions.IgnoreCase);
                var nameM = Regex.Match(xmlText, @"NAME\s*=\s*""([^""]+)""", RegexOptions.IgnoreCase);
                var setM = Regex.Match(xmlText, @"<SETID>([^<]*)</SETID>", RegexOptions.IgnoreCase);
                if (idM.Success) { eifId = idM.Groups[1].Value; fields["ID"] = eifId; }
                if (nameM.Success) { eifName = nameM.Groups[1].Value; fields["NAME"] = eifName; }
                if (setM.Success) { lotId = setM.Groups[1].Value; fields["SETID"] = lotId; }
            }

            var label = string.IsNullOrWhiteSpace(eifId)
                ? $"{dir}(ASC)"
                : string.IsNullOrWhiteSpace(eifName) ? eifId : $"{eifId} {eifName}";

            var from = dir.Equals("RECV", StringComparison.OrdinalIgnoreCase) ? Actor.Plc : Actor.Eif;
            var to = dir.Equals("RECV", StringComparison.OrdinalIgnoreCase) ? Actor.Eif : Actor.Plc;

            yield return new TimeFloorEvent
            {
                Id = $"pctrace-{seq++}-{headerLine}",
                Timestamp = DateTime.Parse(match.Groups["ts"].Value),
                Source = EventSource.Trace,
                Category = "TRACE-ASC",
                Title = label,
                Direction = dir,
                MessageType = eifId,
                Signal = eifId,
                LotId = string.IsNullOrWhiteSpace(lotId) ? null : lotId,
                ProcId = string.IsNullOrWhiteSpace(procId) ? null : procId,
                Level = match.Groups["level"].Value,
                From = from,
                To = to,
                Label = label,
                SubLabel = dir,
                Value = eqpId,
                Fields = fields,
                IsAlarm = AlarmDetector.IsAlarm(fields, xmlText),
                RawSnippet = Truncate(xmlText, 4000)
            };
        }
    }

    private static string Truncate(string text, int max)
        => text.Length <= max ? text : text[..max] + "…";
}
