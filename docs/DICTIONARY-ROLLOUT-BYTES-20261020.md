# Exact Dictionary rollout bytes

The complete prepared release contains 64,616 entries, 109,487 senses and 81,099 examples. Its 256 packed shards and 1,652 search objects remain immutable and checksum verified; staging uses batches of eight objects.

Mac preparation and Linux staging produced different gzip OS header bytes (19 versus 3). Recompressing a previously uploaded shard correctly failed the immutable object guard before any entry was imported or a channel activated. Staging now uses the approved compressed bytes directly. It validates every shard and entry and derives exact per-entry ranges from the existing gzip members rather than recompressing them. The frozen source plan, release identity and approval guards are unchanged.

Regression evidence: a packed fixture with foreign OS headers and a different compression level preserves its bytes and decodes every exact range. The publication/save/rollback database test preloads foreign-header immutable objects and imports them successfully. Prepared checksum, content mismatch and range validation remain enforced. This is transport validation and does not imply that every contextual meaning has received human editorial review.
