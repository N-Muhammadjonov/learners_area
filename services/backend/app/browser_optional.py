"""Explicit widget failure states. A failed read is never represented as zero."""
class OptionalReads:
    def __init__(self): self.failed=set()

    async def read(self, name, operation):
        try: return await operation()
        except Exception:
            self.failed.add(name)
            return None
