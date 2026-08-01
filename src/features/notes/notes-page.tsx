import { NotebookPen } from 'lucide-react';

import { EmptyState } from '../../components/common/empty-state';

export function NotesPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">笔记</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          集中查看未来从书籍中整理的想法。
        </p>
      </header>
      <EmptyState
        description="笔记编辑器尚未实现。本页当前仅用于验证应用布局与路由。"
        icon={<NotebookPen size={28} />}
        title="暂无笔记"
      />
    </div>
  );
}
