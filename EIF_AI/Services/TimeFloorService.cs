using System.Text.RegularExpressions;
using EIF_AI.Models;
using Microsoft.Extensions.Options;

namespace EIF_AI.Services;

public sealed class LogPathOptions
{
    /// <summary>Optional default start folder when opening the picker.</summary>
    public string Root { get; set; } = "../LOG";
}

public sealed partial class TimeFloorService
{
    private readonly string _defaultStart;
    private readonly SfcLogParser _sfcParser;
    private readonly SolaceLogParser _solaceParser;
    private readonly TraceLogParser _traceParser;
    private readonly PcTraceLogParser _pcTraceParser;

    [GeneratedRegex(@"^(?<prefix>.*?)_?(?<date>\d{6})\.log$", RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex FileDateRegex();

    public TimeFloorService(
        IOptions<LogPathOptions> options,
        SfcLogParser sfcParser,
        SolaceLogParser solaceParser,
        TraceLogParser traceParser,
        PcTraceLogParser pcTraceParser)
    {
        var root = options.Value.Root;
        if (!Path.IsPathRooted(root))
            root = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), root));

        _defaultStart = root;
        _sfcParser = sfcParser;
        _solaceParser = solaceParser;
        _traceParser = traceParser;
        _pcTraceParser = pcTraceParser;
    }

    public string RootDirectory => _defaultStart;

    public string NormalizeFolderPath(string? folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath))
            throw new ArgumentException("Log folder is required.");

        var full = Path.GetFullPath(folderPath.Trim());
        if (!Directory.Exists(full))
            throw new ArgumentException($"Folder not found: {full}");

        return full;
    }

    public (string FolderDir, string SfcDir, string SolaceDir, string TraceDir) ResolveDirs(string folderPath)
    {
        var folder = NormalizeFolderPath(folderPath);
        return (
            folder,
            Path.Combine(folder, "SFC"),
            Path.Combine(folder, "SOLACE"),
            Path.Combine(folder, "TRACE"));
    }

    private static bool HasSolaceDir(string fullPath) =>
        Directory.Exists(Path.Combine(fullPath, "SOLACE"));

    private static bool IsPcMode(string fullPath) => HasSolaceDir(fullPath);

    private static bool IsLogFolder(string fullPath) =>
        Directory.Exists(Path.Combine(fullPath, "SFC"))
        || Directory.Exists(Path.Combine(fullPath, "SOLACE"))
        || Directory.Exists(Path.Combine(fullPath, "TRACE"));

    private static bool HasSubDirectories(string fullPath)
    {
        try
        {
            return Directory.EnumerateDirectories(fullPath).Any();
        }
        catch
        {
            return false;
        }
    }

    public BrowseResult Browse(string? path)
    {
        // Empty / computer root → list drives
        if (string.IsNullOrWhiteSpace(path) || path is "." or "\\")
            return BrowseComputer();

        var currentFull = Path.GetFullPath(path.Trim());
        if (!Directory.Exists(currentFull))
            throw new DirectoryNotFoundException($"Folder not found: {currentFull}");

        string? parentPath = null;
        var parent = Directory.GetParent(currentFull);
        parentPath = parent?.FullName; // null at drive root → go to computer

        var entries = new List<BrowseEntry>();

        try
        {
            foreach (var dir in Directory.EnumerateDirectories(currentFull).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    var name = Path.GetFileName(dir);
                    var hasSfc = Directory.Exists(Path.Combine(dir, "SFC"));
                    var hasSolace = Directory.Exists(Path.Combine(dir, "SOLACE"));
                    var hasTrace = Directory.Exists(Path.Combine(dir, "TRACE"));
                    entries.Add(new BrowseEntry
                    {
                        Name = name,
                        Path = Path.GetFullPath(dir),
                        IsDirectory = true,
                        IsSelectable = hasSfc || hasSolace || hasTrace,
                        HasSfc = hasSfc,
                        HasSolace = hasSolace,
                        HasTrace = hasTrace,
                        HasChildren = HasSubDirectories(dir)
                    });
                }
                catch
                {
                    // skip inaccessible
                }
            }

            foreach (var file in Directory.EnumerateFiles(currentFull).OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    var name = Path.GetFileName(file);
                    entries.Add(new BrowseEntry
                    {
                        Name = name,
                        Path = Path.GetFullPath(file),
                        IsDirectory = false,
                        IsSelectable = false,
                        Size = new FileInfo(file).Length
                    });
                }
                catch
                {
                    // skip
                }
            }
        }
        catch (UnauthorizedAccessException ex)
        {
            throw new ArgumentException($"Access denied: {ex.Message}");
        }

        var crumbs = currentFull
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries)
            .ToList();

        return new BrowseResult
        {
            RootName = "이 PC",
            CurrentPath = currentFull,
            ParentPath = parentPath,
            IsComputerRoot = false,
            CurrentIsSelectable = IsLogFolder(currentFull),
            Breadcrumbs = crumbs,
            Entries = entries
        };
    }

    private static BrowseResult BrowseComputer()
    {
        var entries = new List<BrowseEntry>();
        foreach (var drive in DriveInfo.GetDrives().Where(d => d.IsReady).OrderBy(d => d.Name))
        {
            var root = drive.RootDirectory.FullName;
            var label = string.IsNullOrWhiteSpace(drive.VolumeLabel) ? "로컬 디스크" : drive.VolumeLabel;
            entries.Add(new BrowseEntry
            {
                Name = $"{drive.Name.TrimEnd('\\')} ({label})",
                Path = root,
                IsDirectory = true,
                IsSelectable = IsLogFolder(root),
                HasSfc = Directory.Exists(Path.Combine(root, "SFC")),
                HasSolace = Directory.Exists(Path.Combine(root, "SOLACE")),
                HasTrace = Directory.Exists(Path.Combine(root, "TRACE")),
                HasChildren = true
            });
        }

        return new BrowseResult
        {
            RootName = "이 PC",
            CurrentPath = "",
            ParentPath = null,
            IsComputerRoot = true,
            CurrentIsSelectable = false,
            Breadcrumbs = [],
            Entries = entries
        };
    }

    public FolderTreeNode GetComputerTree()
    {
        var drives = DriveInfo.GetDrives()
            .Where(d => d.IsReady)
            .OrderBy(d => d.Name)
            .Select(d =>
            {
                var root = d.RootDirectory.FullName;
                var label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? "로컬 디스크" : d.VolumeLabel;
                return new FolderTreeNode
                {
                    Name = $"{d.Name.TrimEnd('\\')} ({label})",
                    Path = root,
                    IsSelectable = IsLogFolder(root),
                    HasChildren = true,
                    Children = []
                };
            })
            .ToList();

        return new FolderTreeNode
        {
            Name = "이 PC",
            Path = "",
            IsSelectable = false,
            HasChildren = drives.Count > 0,
            Children = drives
        };
    }

    public IReadOnlyList<FolderTreeNode> GetTreeChildren(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return GetComputerTree().Children;

        var full = Path.GetFullPath(path.Trim());
        if (!Directory.Exists(full))
            return [];

        var list = new List<FolderTreeNode>();
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(full).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    list.Add(new FolderTreeNode
                    {
                        Name = Path.GetFileName(dir),
                        Path = Path.GetFullPath(dir),
                        IsSelectable = IsLogFolder(dir),
                        HasChildren = HasSubDirectories(dir),
                        Children = []
                    });
                }
                catch
                {
                    // skip
                }
            }
        }
        catch (UnauthorizedAccessException)
        {
            // empty
        }

        return list;
    }

    public string? GetDefaultStartPath()
    {
        if (Directory.Exists(_defaultStart))
            return _defaultStart;

        var desktopLog = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "EIF_AI", "LOG");
        if (Directory.Exists(desktopLog))
            return desktopLog;

        return DriveInfo.GetDrives().FirstOrDefault(d => d.IsReady)?.RootDirectory.FullName;
    }

    public IReadOnlyList<LogTypeInfo> ListLogTypes()
    {
        // Kept for health: show children of default LOG if present
        if (!Directory.Exists(_defaultStart))
            return [];

        return Directory.EnumerateDirectories(_defaultStart)
            .Select(dir =>
            {
                var name = Path.GetFileName(dir);
                var sessions = ListSessions(dir);
                return new LogTypeInfo
                {
                    Name = name,
                    HasSfc = Directory.Exists(Path.Combine(dir, "SFC")),
                    HasSolace = Directory.Exists(Path.Combine(dir, "SOLACE")),
                    HasTrace = Directory.Exists(Path.Combine(dir, "TRACE")),
                    SessionCount = sessions.Count
                };
            })
            .OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public IReadOnlyList<LogSessionInfo> ListSessions(string folderPath)
    {
        var folder = NormalizeFolderPath(folderPath);
        var (_, sfcDir, solaceDir, traceDir) = ResolveDirs(folder);
        var map = new Dictionary<string, LogSessionInfo>(StringComparer.OrdinalIgnoreCase);
        var label = folder;
        // SOLACE folders pair by date (CallBizMES_061714 ↔ TRACE _061714 / PLCCore_*_061714)
        var pairByDate = IsPcMode(folder);

        void Upsert(string fileName, string? side)
        {
            var key = BuildSessionKey(fileName, pairByDate, out var eq, out var date);
            if (key is null) return;

            if (!map.TryGetValue(key, out var existing))
            {
                map[key] = new LogSessionInfo
                {
                    Id = key,
                    LogType = label,
                    EquipmentKey = string.IsNullOrWhiteSpace(eq) ? (pairByDate ? "PC" : key) : eq,
                    DateSuffix = date,
                    SfcFileName = side == "sfc" ? fileName : null,
                    SolaceFileName = side == "solace" ? fileName : null,
                    TraceFileName = side == "trace" ? fileName : null
                };
                return;
            }

            map[key] = new LogSessionInfo
            {
                Id = existing.Id,
                LogType = label,
                EquipmentKey = PreferEquipment(existing.EquipmentKey, eq, pairByDate),
                DateSuffix = existing.DateSuffix,
                SfcFileName = side == "sfc" ? fileName : existing.SfcFileName,
                SolaceFileName = side == "solace" ? fileName : existing.SolaceFileName,
                TraceFileName = side == "trace" ? fileName : existing.TraceFileName
            };
        }

        if (Directory.Exists(sfcDir))
        {
            foreach (var file in Directory.EnumerateFiles(sfcDir, "*.log"))
                Upsert(Path.GetFileName(file), "sfc");
        }

        if (Directory.Exists(solaceDir))
        {
            foreach (var file in Directory.EnumerateFiles(solaceDir, "*.log"))
                Upsert(Path.GetFileName(file), "solace");
        }

        if (Directory.Exists(traceDir))
        {
            foreach (var file in Directory.EnumerateFiles(traceDir, "*.log"))
                Upsert(Path.GetFileName(file), "trace");
        }

        return map.Values
            .OrderByDescending(s => s.DateSuffix)
            .ThenBy(s => s.EquipmentKey)
            .ToList();
    }

    public TimeFloorResult BuildForType(string folderPath, TimeFloorQuery query)
    {
        var folder = NormalizeFolderPath(folderPath);
        var sessions = ListSessions(folder);
        if (sessions.Count == 0)
            throw new FileNotFoundException($"No SFC/SOLACE/TRACE logs found in {folder}");

        var (_, sfcDir, solaceDir, traceDir) = ResolveDirs(folder);
        var events = new List<TimeFloorEvent>();

        foreach (var session in sessions)
        {
            if (session.HasSfc && (query.Source is null or EventSource.Sfc))
                events.AddRange(_sfcParser.Parse(Path.Combine(sfcDir, session.SfcFileName!)));

            if (session.HasSolace && (query.Source is null or EventSource.Sfc))
                events.AddRange(_solaceParser.Parse(Path.Combine(solaceDir, session.SolaceFileName!)));

            if (session.HasTrace && (query.Source is null or EventSource.Trace))
            {
                var tracePath = Path.Combine(traceDir, session.TraceFileName!);
                if (IsPcAscTraceFile(tracePath))
                    events.AddRange(_pcTraceParser.Parse(tracePath));
                else
                    events.AddRange(_traceParser.Parse(tracePath, query.IncludeBitOff));
            }
        }

        return FinishBuild(
            folder,
            string.Join(", ", sessions.Select(s => s.Id).Distinct()),
            string.Join(", ", sessions.Select(s => s.EquipmentKey).Distinct()),
            events,
            query);
    }

    /// <summary>
    /// PCTYPE TRACE uses [RECV(ASC)]/[SEND(ASC)]; PLCTYPE TRACE uses I_/O_ bit/word lines.
    /// </summary>
    private static bool IsPcAscTraceFile(string filePath)
    {
        try
        {
            using var reader = new StreamReader(filePath);
            for (var i = 0; i < 80 && !reader.EndOfStream; i++)
            {
                var line = reader.ReadLine();
                if (line is null) break;
                if (line.Contains("RECV(ASC)", StringComparison.Ordinal)
                    || line.Contains("SEND(ASC)", StringComparison.Ordinal))
                    return true;
            }
        }
        catch
        {
            // fall through to PLC parser
        }

        return false;
    }

    private static string PreferEquipment(string existing, string incoming, bool pcMode)
    {
        if (string.IsNullOrWhiteSpace(existing) || existing is "PC" or "_")
            return string.IsNullOrWhiteSpace(incoming) ? (pcMode ? "PC" : existing) : incoming;
        if (string.IsNullOrWhiteSpace(incoming) || incoming is "_")
            return existing;
        // Prefer non-generic CallBizMES / equipment name over empty/PC
        if (existing.Equals("PC", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(incoming))
            return incoming;
        return existing;
    }

    private static TimeFloorResult FinishBuild(
        string type,
        string sessionId,
        string equipmentKey,
        List<TimeFloorEvent> events,
        TimeFloorQuery query)
    {
        events = events.OrderBy(e => e.Timestamp).ThenBy(e => e.Id).ToList();

        IEnumerable<TimeFloorEvent> filtered = events;

        if (!string.IsNullOrWhiteSpace(query.LotId))
            filtered = FilterByLot(events, query.LotId.Trim());

        if (query.From is not null)
            filtered = filtered.Where(e => e.Timestamp >= query.From.Value);

        if (query.To is not null)
            filtered = filtered.Where(e => e.Timestamp <= query.To.Value);

        var list = filtered.OrderBy(e => e.Timestamp).ThenBy(e => e.Id).ToList();
        if (query.Limit is > 0 && list.Count > query.Limit.Value)
            list = list.Take(query.Limit.Value).ToList();

        var lotIds = events
            .Select(e => e.LotId)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(id => id, StringComparer.OrdinalIgnoreCase)
            .Cast<string>()
            .ToList();

        return new TimeFloorResult
        {
            SessionId = sessionId,
            LogType = type,
            EquipmentKey = equipmentKey,
            LotId = string.IsNullOrWhiteSpace(query.LotId) ? null : query.LotId.Trim(),
            StartTime = list.Count > 0 ? list[0].Timestamp : null,
            EndTime = list.Count > 0 ? list[^1].Timestamp : null,
            TotalEvents = list.Count,
            LotIds = lotIds,
            Events = list,
            Messages = SequenceMapper.ToMessages(list)
        };
    }

    private static List<TimeFloorEvent> FilterByLot(List<TimeFloorEvent> all, string lot)
    {
        var anchors = all
            .Where(e => string.Equals(e.LotId, lot, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (anchors.Count == 0)
            return [];

        var selected = new HashSet<string>(StringComparer.Ordinal);
        foreach (var anchor in anchors)
            selected.Add(anchor.Id);

        var orderedAnchors = anchors.OrderBy(a => a.Timestamp).ToList();
        var clusters = new List<(DateTime Start, DateTime End, HashSet<string> Positions)>();
        DateTime? cStart = null;
        DateTime cEnd = default;
        var positions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Flush()
        {
            if (cStart is null) return;
            clusters.Add((cStart.Value.AddSeconds(-2), cEnd.AddSeconds(3), new HashSet<string>(positions, StringComparer.OrdinalIgnoreCase)));
            cStart = null;
            positions.Clear();
        }

        foreach (var a in orderedAnchors)
        {
            if (cStart is null)
            {
                cStart = a.Timestamp;
                cEnd = a.Timestamp;
                if (!string.IsNullOrWhiteSpace(a.Position)) positions.Add(a.Position!);
                continue;
            }

            if ((a.Timestamp - cEnd).TotalSeconds > 30)
            {
                Flush();
                cStart = a.Timestamp;
                cEnd = a.Timestamp;
                if (!string.IsNullOrWhiteSpace(a.Position)) positions.Add(a.Position!);
            }
            else
            {
                cEnd = a.Timestamp;
                if (!string.IsNullOrWhiteSpace(a.Position)) positions.Add(a.Position!);
            }
        }
        Flush();

        foreach (var (start, end, posSet) in clusters)
        {
            foreach (var e in all)
            {
                if (e.Timestamp < start || e.Timestamp > end)
                    continue;

                if (string.Equals(e.LotId, lot, StringComparison.OrdinalIgnoreCase))
                {
                    selected.Add(e.Id);
                    continue;
                }

                if (e.Source == EventSource.Trace && e.LotId is null)
                {
                    if (posSet.Count == 0
                        || (e.Position is not null && posSet.Contains(e.Position))
                        || NearbySamePosition(e, anchors, 4))
                    {
                        selected.Add(e.Id);
                    }
                    continue;
                }

                if (e.Source == EventSource.Sfc && e.LotId is null)
                {
                    var near = anchors.Any(a =>
                        Math.Abs((a.Timestamp - e.Timestamp).TotalSeconds) <= 2
                        && (string.IsNullOrEmpty(e.ProcId)
                            || string.IsNullOrEmpty(a.ProcId)
                            || string.Equals(a.ProcId, e.ProcId, StringComparison.OrdinalIgnoreCase)));
                    if (near)
                        selected.Add(e.Id);
                }
            }
        }

        return all.Where(e => selected.Contains(e.Id)).ToList();
    }

    private static bool NearbySamePosition(TimeFloorEvent bit, List<TimeFloorEvent> anchors, double seconds)
    {
        return anchors.Any(a =>
            Math.Abs((a.Timestamp - bit.Timestamp).TotalSeconds) <= seconds
            && (bit.Position is null
                || a.Position is null
                || string.Equals(a.Position, bit.Position, StringComparison.OrdinalIgnoreCase)));
    }

    private static string? BuildSessionKey(string fileName, bool pcMode, out string equipment, out string date)
    {
        equipment = "";
        date = "";

        var m = FileDateRegex().Match(fileName);
        if (!m.Success)
            return null;

        date = m.Groups["date"].Value;
        var prefix = (m.Groups["prefix"].Value ?? "").Trim('_', ' ', '.');

        if (string.IsNullOrWhiteSpace(prefix))
        {
            equipment = pcMode ? "PC" : "";
            return pcMode ? date : null;
        }

        if (prefix.Contains("CSFCInterface", StringComparison.OrdinalIgnoreCase))
            equipment = prefix.Replace("CSFCInterface_", "", StringComparison.OrdinalIgnoreCase);
        else if (prefix.Contains("PLCCore_", StringComparison.OrdinalIgnoreCase))
        {
            var idx = prefix.LastIndexOf("PLCCore_", StringComparison.OrdinalIgnoreCase);
            equipment = prefix[(idx + "PLCCore_".Length)..];
        }
        else if (prefix.Equals("CallBizMES", StringComparison.OrdinalIgnoreCase))
            equipment = "CallBizMES";
        else
            equipment = prefix;

        // PC/SOLACE: pair CallBizMES_061714 with TRACE _061714 by date
        if (pcMode)
            return date;

        return $"{equipment}_{date}";
    }
}
