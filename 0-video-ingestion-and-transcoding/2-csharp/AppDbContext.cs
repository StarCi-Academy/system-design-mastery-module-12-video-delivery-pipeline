using Microsoft.EntityFrameworkCore;

namespace TranscodeService;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<TranscodeJob> TranscodeJobs => Set<TranscodeJob>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TranscodeJob>().ToTable("transcode_jobs");
    }
}
