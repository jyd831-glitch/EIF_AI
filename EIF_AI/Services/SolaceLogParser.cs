using System.Text.RegularExpressions;
using EIF_AI.Models;

namespace EIF_AI.Services;

/// <summary>
/// Parses CallBizMES / SOLACE logs (REQUEST + RECEIVE_REPLYQ) into MES↔EIF sequence events.
/// Supports both timestamp styles:
///   [2026-06-17 14:00:02.883] [Info] [CallBizMES] (REQUEST) ...
///   2026-09-15 02:00:11.662 [Info] [CallBizSolaceMES] (REQUEST) ...
/// </summary>
public sealed partial class SolaceLogParser
{
    [GeneratedRegex(
        @"^\[?(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\]?\s+\[(?<level>\w+)\]\s+\[(?<module>[^\]]+)\]\s+\((?<kind>[A-Z_]+)\)\s+(?<rest>.*)$",
        RegexOptions.Compiled)]
    private static partial Regex HeaderRegex();

    [GeneratedRegex(@"^\[?\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\]?\s+\[", RegexOptions.Compiled)]
    private static partial Regex TimestampStartRegex();

    [GeneratedRegex(@"""actID""\s*:\s*""(?<v>[^""]+)""", RegexOptions.Compiled)]
    private static partial Regex ActIdRegex();

    [GeneratedRegex(@"\\?""LOT_ID\\?""\s*:\s*\\?""(?<v>[^\\""]*)\\?""", RegexOptions.Compiled)]
    private static partial Regex LotIdRegex();

    [GeneratedRegex(@"\\?""BARCODE_VALUE\\?""\s*:\s*\\?""(?<v>[^\\""]*)\\?""", RegexOptions.Compiled)]
    private static partial Regex BarcodeRegex();

    [GeneratedRegex(@"\\?""STREAM_FUNCTION_ID\\?""\s*:\s*\\?""(?<v>[^\\""]*)\\?""", RegexOptions.Compiled)]
    private static partial Regex StreamIdRegex();

    [GeneratedRegex(@"\\?""COMMUNICATION_DIRECTION_CODE\\?""\s*:\s*\\?""(?<v>[^\\""]*)\\?""", RegexOptions.Compiled)]
    private static partial Regex DirCodeRegex();

    [GeneratedRegex(@"ID=\\+""(?<id>[^\\""]+)\\+""(?:[^\\]*NAME=\\+""(?<name>[^\\""]*)\\+"")?", RegexOptions.Compiled)]
    private static partial Regex EifIdNameRegex();

    [GeneratedRegex(@"EIF/RAW_DATA\((?<uuid>[^)]+)\)", RegexOptions.Compiled)]
    private static partial Regex RequestUuidRegex();

    [GeneratedRegex(@"\((?<uuid>[0-9a-fA-F\-]{36})\)\s*:", RegexOptions.Compiled)]
    private static partial Regex ReplyUuidRegex();

    [GeneratedRegex(@"""JOB_CODE""\s*:\s*""(?<v>[^""]*)""", RegexOptions.Compiled)]
    private static partial Regex JobCodeRegex();

    [GeneratedRegex(@"\\?""RESULT\\?""\s*:\s*\\?""(?<v>[^\\""]*)\\?""", RegexOptions.Compiled)]
    private static partial Regex ResultRegex();

    [GeneratedRegex(@"\\?""LINESTOP\\?""\s*:\s*\\?""(?<v>[^\\""]*)\\?""", RegexOptions.Compiled)]
    private static partial Regex LineStopRegex();

    [GeneratedRegex(@"<RESULT>(?<v>[^<]*)</RESULT>", RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex XmlResultRegex();

    [GeneratedRegex(@"<LINESTOP>(?<v>[^<]*)</LINESTOP>", RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex XmlLineStopRegex();

    public IEnumerable<TimeFloorEvent> Parse(string filePath)
    {
        var lines = File.ReadAllLines(filePath);
        var index = 0;
        var seq = 0;
        // Skip noise biz: transaction-log wrappers + their replies
        var skippedRequestIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var requestBizById = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var requestLotById = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

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

            var kind = match.Groups["kind"].Value;
            if (kind is not ("REQUEST" or "RECEIVE_REPLYQ"))
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
                if (TimestampStartRegex().IsMatch(next))
                    break;

                body.Add(next);
                index++;
            }

            var raw = string.Join('\n', body);
            var rest = match.Groups["rest"].Value;
            var ts = DateTime.Parse(match.Groups["ts"].Value);

            if (kind == "REQUEST")
            {
                var actId = ActIdRegex().Match(raw).Groups["v"].Value;
                if (string.IsNullOrWhiteSpace(actId))
                    actId = "REQUEST";

                var uuid = RequestUuidRegex().Match(rest).Groups["uuid"].Value;

                if (IsIgnoredActId(actId))
                {
                    if (!string.IsNullOrWhiteSpace(uuid))
                        skippedRequestIds.Add(uuid);
                    continue;
                }

                var lotId = LotIdRegex().Match(raw).Groups["v"].Value;
                if (string.IsNullOrWhiteSpace(lotId))
                    lotId = BarcodeRegex().Match(raw).Groups["v"].Value;

                var streamId = StreamIdRegex().Match(raw).Groups["v"].Value;
                var dirCode = DirCodeRegex().Match(raw).Groups["v"].Value;

                var eif = EifIdNameRegex().Match(raw);
                var eifId = eif.Success ? eif.Groups["id"].Value : null;
                var eifName = eif.Success ? eif.Groups["name"].Value : null;

                var bizName = ShortActId(actId);
                string? subLabel;
                if (!string.IsNullOrWhiteSpace(streamId))
                {
                    subLabel = string.IsNullOrWhiteSpace(eifName)
                        ? streamId
                        : $"{streamId} {eifName}";
                }
                else if (!string.IsNullOrWhiteSpace(eifId))
                {
                    subLabel = string.IsNullOrWhiteSpace(eifName) ? eifId : $"{eifId} {eifName}";
                }
                else
                {
                    subLabel = "REQUEST";
                }

                if (!string.IsNullOrWhiteSpace(uuid))
                {
                    requestBizById[uuid] = bizName;
                    if (!string.IsNullOrWhiteSpace(lotId))
                        requestLotById[uuid] = lotId;
                }

                var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["ACT_ID"] = actId,
                    ["KIND"] = "REQUEST"
                };
                if (!string.IsNullOrWhiteSpace(streamId)) fields["STREAM_FUNCTION_ID"] = streamId;
                if (!string.IsNullOrWhiteSpace(dirCode)) fields["COMMUNICATION_DIRECTION_CODE"] = dirCode;
                if (!string.IsNullOrWhiteSpace(uuid)) fields["CORRELATION_ID"] = uuid;
                if (!string.IsNullOrWhiteSpace(eifId)) fields["EIF_ID"] = eifId;
                if (!string.IsNullOrWhiteSpace(eifName)) fields["EIF_NAME"] = eifName;
                AddResultLineStopFields(raw, fields);

                yield return new TimeFloorEvent
                {
                    Id = $"solace-{seq++}-{headerLine}",
                    Timestamp = ts,
                    Source = EventSource.Sfc,
                    Category = "SOLACE",
                    Title = bizName,
                    Direction = "EIF->MES",
                    MessageType = actId,
                    LotId = string.IsNullOrWhiteSpace(lotId) ? null : lotId,
                    MsgId = streamId,
                    Level = match.Groups["level"].Value,
                    From = Actor.Eif,
                    To = Actor.Mes,
                    Label = bizName,
                    SubLabel = subLabel,
                    Fields = fields,
                    IsAlarm = AlarmDetector.IsAlarm(fields, raw),
                    RawSnippet = Truncate(raw, 4000)
                };
            }
            else // RECEIVE_REPLYQ
            {
                var uuid = ReplyUuidRegex().Match(rest).Groups["uuid"].Value;
                if (!string.IsNullOrWhiteSpace(uuid) && skippedRequestIds.Contains(uuid))
                    continue;

                var jobCode = JobCodeRegex().Match(raw).Groups["v"].Value;
                requestBizById.TryGetValue(uuid, out var bizName);
                requestLotById.TryGetValue(uuid, out var lotId);

                var label = !string.IsNullOrWhiteSpace(bizName)
                    ? bizName
                    : string.IsNullOrWhiteSpace(jobCode) ? "REPLY" : $"REPLY JOB : {jobCode}";
                var subLabel = string.IsNullOrWhiteSpace(jobCode) ? "REPLY" : $"REPLY : {jobCode}";

                var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["KIND"] = "RECEIVE_REPLYQ"
                };
                if (!string.IsNullOrWhiteSpace(uuid)) fields["CORRELATION_ID"] = uuid;
                if (!string.IsNullOrWhiteSpace(jobCode)) fields["JOB_CODE"] = jobCode;
                if (!string.IsNullOrWhiteSpace(bizName)) fields["ACT_ID"] = bizName;
                AddResultLineStopFields(raw, fields);

                yield return new TimeFloorEvent
                {
                    Id = $"solace-{seq++}-{headerLine}",
                    Timestamp = ts,
                    Source = EventSource.Sfc,
                    Category = "SOLACE",
                    Title = label,
                    Direction = "MES->EIF",
                    MessageType = "RECEIVE_REPLYQ",
                    LotId = string.IsNullOrWhiteSpace(lotId) ? null : lotId,
                    Level = match.Groups["level"].Value,
                    From = Actor.Mes,
                    To = Actor.Eif,
                    Label = label,
                    SubLabel = subLabel,
                    Fields = fields,
                    IsAlarm = AlarmDetector.IsAlarm(fields, raw),
                    RawSnippet = Truncate(raw, 4000)
                };
            }
        }
    }

    private static void AddResultLineStopFields(string raw, Dictionary<string, string> fields)
    {
        var result = ResultRegex().Match(raw);
        if (!result.Success) result = XmlResultRegex().Match(raw);
        if (result.Success && !string.IsNullOrWhiteSpace(result.Groups["v"].Value))
            fields["RESULT"] = result.Groups["v"].Value;

        var lineStop = LineStopRegex().Match(raw);
        if (!lineStop.Success) lineStop = XmlLineStopRegex().Match(raw);
        if (lineStop.Success && !string.IsNullOrWhiteSpace(lineStop.Groups["v"].Value))
            fields["LINESTOP"] = lineStop.Groups["v"].Value;
    }

    private static bool IsIgnoredActId(string actId) =>
        actId.Equals("BR_SFC_RegisterTransactionLogEIF", StringComparison.OrdinalIgnoreCase)
        || actId.Equals("SFC_RegisterTransactionLogEIF", StringComparison.OrdinalIgnoreCase);

    private static string ShortActId(string actId)
    {
        if (actId.StartsWith("BR_", StringComparison.OrdinalIgnoreCase))
            return actId[3..];
        return actId;
    }

    private static string Truncate(string text, int max)
        => text.Length <= max ? text : text[..max] + "…";
}
