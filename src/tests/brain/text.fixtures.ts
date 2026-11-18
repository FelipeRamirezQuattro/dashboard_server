import { normalize, tokensFor } from "../../services/brain/text";

const assertDeepEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

assertDeepEqual(tokensFor("What's the head of Sales?"), ["head", "sales"], "tokensFor strips stop words");
assertDeepEqual(normalize("It’s A-B"), "its a b", "normalize folds punctuation");
