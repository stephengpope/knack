import { KnackLoader } from "@/components/brand/loader";

export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <KnackLoader size={72} label="Getting your workspace ready…" />
    </div>
  );
}
