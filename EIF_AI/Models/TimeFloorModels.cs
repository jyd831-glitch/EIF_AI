namespace EIF_AI.Models;

public enum EventSource
{
    Sfc,
    Trace
}

public enum Actor
{
    Mes,
    Eif,
    Plc
}

public sealed class LogTypeInfo
{
    public required string Name { get; init; }
    public bool HasSfc { get; init; }
    public bool HasSolace { get; init; }
    public bool HasTrace { get; init; }
    public int SessionCount { get; init; }
}

public sealed class BrowseEntry
{
    public required string Name { get; init; }
    public required string Path { get; init; }
    public bool IsDirectory { get; init; }
    public bool IsSelectable { get; init; }
    public bool HasSfc { get; init; }
    public bool HasSolace { get; init; }
    public bool HasTrace { get; init; }
    public bool HasChildren { get; init; }
    public long? Size { get; init; }
}

public sealed class BrowseResult
{
    public required string RootName { get; init; }
    public required string CurrentPath { get; init; }
    public string? ParentPath { get; init; }
    public bool IsComputerRoot { get; init; }
    public bool CurrentIsSelectable { get; init; }
    public IReadOnlyList<string> Breadcrumbs { get; init; } = [];
    public IReadOnlyList<BrowseEntry> Entries { get; init; } = [];
}

public sealed class FolderTreeNode
{
    public required string Name { get; init; }
    public required string Path { get; init; }
    public bool IsSelectable { get; init; }
    public bool HasChildren { get; init; }
    public IReadOnlyList<FolderTreeNode> Children { get; init; } = [];
}

public sealed class LogSessionInfo
{
    public required string Id { get; init; }
    public required string LogType { get; init; }
    public required string EquipmentKey { get; init; }
    public required string DateSuffix { get; init; }
    public string? SfcFileName { get; init; }
    public string? SolaceFileName { get; init; }
    public string? TraceFileName { get; init; }
    public bool HasSfc => !string.IsNullOrEmpty(SfcFileName);
    public bool HasSolace => !string.IsNullOrEmpty(SolaceFileName);
    public bool HasTrace => !string.IsNullOrEmpty(TraceFileName);
}

public sealed class TimeFloorEvent
{
    public required string Id { get; init; }
    public required DateTime Timestamp { get; init; }
    public required EventSource Source { get; init; }
    public required string Category { get; init; }
    public required string Title { get; init; }
    public string? Direction { get; init; }
    public string? Signal { get; init; }
    public string? MessageType { get; init; }
    public string? LotId { get; init; }
    public string? Position { get; init; }
    public string? ProcId { get; init; }
    public string? MsgId { get; init; }
    public string? Value { get; init; }
    public string? Level { get; init; }
    public Actor? From { get; init; }
    public Actor? To { get; init; }
    public string? Label { get; init; }
    public string? SubLabel { get; init; }
    public bool HasBit { get; init; }
    public bool HasWord { get; init; }
    public bool IsAlarm { get; init; }
    public Dictionary<string, string> Fields { get; init; } = new();
    public string? RawSnippet { get; init; }
}

public sealed class SequenceMessage
{
    public required string Id { get; init; }
    public required DateTime Timestamp { get; init; }
    public required Actor From { get; init; }
    public required Actor To { get; init; }
    public required string Label { get; init; }
    public string? SubLabel { get; init; }
    public string? LotId { get; init; }
    public string? Position { get; init; }
    public EventSource Source { get; init; }
    public string? Signal { get; init; }
    public string? Value { get; init; }
    public string? RawSnippet { get; init; }
    public bool IsAlarm { get; init; }
    public Dictionary<string, string> Fields { get; init; } = new();
    public string? WordSignal { get; init; }
    public DateTime? WordTimestamp { get; init; }
    public string? WordRawSnippet { get; init; }
    public Dictionary<string, string>? WordFields { get; init; }
}

public sealed class TimeFloorResult
{
    public required string SessionId { get; init; }
    public required string LogType { get; init; }
    public required string EquipmentKey { get; init; }
    public string? LotId { get; init; }
    public DateTime? StartTime { get; init; }
    public DateTime? EndTime { get; init; }
    public int TotalEvents { get; init; }
    public IReadOnlyList<string> LotIds { get; init; } = [];
    public IReadOnlyList<TimeFloorEvent> Events { get; init; } = [];
    public IReadOnlyList<SequenceMessage> Messages { get; init; } = [];
}

public sealed class TimeFloorQuery
{
    public string? LotId { get; set; }
    public EventSource? Source { get; set; }
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public bool IncludeBitOff { get; set; } = true;
    public int? Limit { get; set; }
}
