import React from "react";
/** Image loading is browser QA; component tests retain image attributes and callbacks. */
export default function Image(props: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) {
  const imageProps = { ...props }; delete imageProps.unoptimized;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...imageProps} alt={imageProps.alt ?? ""} />;
}
