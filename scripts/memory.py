class MemoryService:
    def __init__(self, storage, llm):
        self.s=storage; self.llm=llm

    def update(self,pixel_id,event):
        old=self.s.pixel_memory(pixel_id)
        delta,audit=self.llm.update_memory(old,event)
        mem=old
        for x in delta.get("memory_remove",[]):
            mem["working_memory"]=[m for m in mem.get("working_memory",[]) if m!=x]
            mem["consolidated_lessons"]=[m for m in mem.get("consolidated_lessons",[]) if m!=x]
        for x in delta.get("memory_add",[]):
            if x not in mem["working_memory"]: mem["working_memory"].append(x)
        self.s.save_pixel_memory(pixel_id,mem)
        return delta,audit
