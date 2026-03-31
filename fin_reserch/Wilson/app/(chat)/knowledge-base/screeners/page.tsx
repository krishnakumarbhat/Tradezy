import { KnowledgeBaseCollection } from "@/components/knowledge-base-collection";

export default function KnowledgeBaseScreenersPage() {
  return (
    <KnowledgeBaseCollection
      description="Your saved screener outputs, linked to your account."
      title="Saved Screeners"
      type="screener"
    />
  );
}
