import { BookOpen } from 'lucide-react';

import { EmptyState } from '../../components/common/empty-state';

export function LibraryPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">书架</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          你的本地图书将在这里显示。
        </p>
      </header>
      <EmptyState
        description="项目骨架已经就绪，图书导入和 EPUB 阅读能力将在后续任务中接入。"
        icon={<BookOpen size={28} />}
        title="书架还是空的"
      />
    </div>
  );
}
