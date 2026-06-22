import { requireUser } from "@/lib/session";
import { listCards } from "@/lib/board";
import { listProjects } from "@/lib/projects";
import { BoardView } from "@/components/board/board-view";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cards, projects] = await Promise.all([
    listCards(user.id),
    listProjects(user.id),
  ]);
  return (
    <BoardView cards={cards} projects={projects} openCardId={sp.card ?? null} />
  );
}
