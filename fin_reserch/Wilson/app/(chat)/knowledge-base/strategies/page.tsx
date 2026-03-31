import { KnowledgeBaseCollection } from "@/components/knowledge-base-collection";

export default function KnowledgeBaseStrategiesPage() {
  return (
    <KnowledgeBaseCollection
      description="Your saved strategy outputs, linked to your account."
      title="Saved Strategies"
      type="strategy"
    />
  );
}
