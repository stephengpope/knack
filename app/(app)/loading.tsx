import { Logomark } from "@/components/brand/logo";

export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Logomark size={30} className="animate-pulse opacity-40" />
    </div>
  );
}
