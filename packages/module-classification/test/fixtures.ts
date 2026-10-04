export const MARKSHEET_TEXT = `
CENTRAL BOARD OF SECONDARY EDUCATION
STATEMENT OF MARKS
Roll No: 1234567   Name: A. STUDENT
Subject          Marks Obtained   Total Marks
Mathematics      88               100
Science          91               100
Total Marks 500  Marks Obtained 441  Percentage 88.2
Result: PASS   Grade A
`;

export const AADHAAR_TEXT = `
Government of India
Unique Identification Authority of India
Aadhaar
A. Student
DOB: 01/01/2005
1234 5678 9012
VID: 9123 4567 8901 2345
`;

export const INCOME_TEXT = `
OFFICE OF THE TAHSILDAR
INCOME CERTIFICATE
This is to certify that the annual income of the family of Shri X
is Rs. 2,40,000 (Rupees Two Lakh Forty Thousand only). Certified that
the above is correct as per revenue records.
`;

// Deliberately noisy OCR: odd case and whitespace, broken line breaks.
export const NOISY_MARKSHEET_TEXT =
  "sTaTeMeNt   of\n\n MARKS   \n roll     no 99  marks\nobtained  total   marks  PERCENTAGE";

// Shares words with two types but is strongly neither.
export const AMBIGUOUS_TEXT = "annual income marks obtained";

export const GIBBERISH_TEXT = "qwx zzk 8271 lorem ipsum dolor sit amet";
