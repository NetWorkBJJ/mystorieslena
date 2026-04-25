import { Wizard } from "@/components/wizard/Wizard";

export default async function RoteiroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Wizard id={id} />;
}
