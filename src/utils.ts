export function capitalizeEnglishWords(text: string): string {
  return text.replace(
    /[a-zA-Z]+/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}