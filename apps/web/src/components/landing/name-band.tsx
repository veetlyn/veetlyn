// The page closes on the name at full width, with the mark's square in the brand colour after it.
export default function NameBand() {
  return (
    <div aria-hidden="true" className="overflow-hidden px-4 pt-24">
      <p className="flex items-end font-heading text-[clamp(72px,23vw,360px)] leading-[0.8] tracking-[-0.04em]">
        Payleor
        <span className="mb-[0.06em] ml-[0.04em] inline-block size-[0.16em] rounded-[0.03em] bg-brand" />
      </p>
    </div>
  );
}
