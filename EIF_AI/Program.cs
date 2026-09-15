using System.Text.Json.Serialization;
using EIF_AI.Models;
using EIF_AI.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.Configure<LogPathOptions>(builder.Configuration.GetSection("LogPath"));
builder.Services.AddSingleton<SfcLogParser>();
builder.Services.AddSingleton<SolaceLogParser>();
builder.Services.AddSingleton<TraceLogParser>();
builder.Services.AddSingleton<PcTraceLogParser>();
builder.Services.AddSingleton<TimeFloorService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", (TimeFloorService svc) => Results.Ok(new
{
    status = "ok",
    defaultStart = svc.RootDirectory,
    defaultStartExists = Directory.Exists(svc.RootDirectory)
}));

app.MapGet("/api/browse", (TimeFloorService svc, string? path) =>
{
    try
    {
        return Results.Ok(svc.Browse(path));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (DirectoryNotFoundException ex)
    {
        return Results.NotFound(new { error = ex.Message });
    }
});

app.MapGet("/api/browse/tree", (TimeFloorService svc, string? path) =>
{
    try
    {
        if (string.IsNullOrWhiteSpace(path))
            return Results.Ok(svc.GetComputerTree());
        return Results.Ok(svc.GetTreeChildren(path));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

app.MapGet("/api/browse/default", (TimeFloorService svc) =>
    Results.Ok(new { path = svc.GetDefaultStartPath() }));

app.MapGet("/api/lots", (TimeFloorService svc, string? folder, string? type) =>
{
    try
    {
        var folderPath = folder ?? type;
        if (string.IsNullOrWhiteSpace(folderPath))
            return Results.BadRequest(new { error = "Log folder is required" });

        var result = svc.BuildForType(folderPath, new TimeFloorQuery
        {
            IncludeBitOff = false,
            Limit = 1
        });
        return Results.Ok(result.LotIds);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (FileNotFoundException ex)
    {
        return Results.NotFound(new { error = ex.Message });
    }
});

app.MapGet("/api/timefloor", (
    TimeFloorService svc,
    string? folder,
    string? type,
    string? lotId,
    string? source,
    DateTime? from,
    DateTime? to,
    bool includeBitOff = true,
    int? limit = 5000) =>
{
    try
    {
        var folderPath = folder ?? type;
        if (string.IsNullOrWhiteSpace(folderPath))
            return Results.BadRequest(new { error = "Log folder is required" });
        if (string.IsNullOrWhiteSpace(lotId))
            return Results.BadRequest(new { error = "LOTID is required" });

        EventSource? sourceFilter = source?.ToLowerInvariant() switch
        {
            "sfc" => EventSource.Sfc,
            "trace" => EventSource.Trace,
            _ => null
        };

        var result = svc.BuildForType(folderPath, new TimeFloorQuery
        {
            LotId = lotId,
            Source = sourceFilter,
            From = from,
            To = to,
            IncludeBitOff = includeBitOff,
            Limit = limit
        });

        return Results.Ok(result);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (FileNotFoundException ex)
    {
        return Results.NotFound(new { error = ex.Message });
    }
});

app.Run();
