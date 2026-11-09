/**
 * How far BEFORE a student's enrolment start a month may still be charged, counted back
 * from the current month. ONE number, read by the server (`takePayment`) and by the view
 * (`buildPaymentView`), so the screen can never offer a month the server would refuse, or the
 * other way round. It is also the server's floor: a year typo such as 1999 is far past it.
 *
 * It lives here, not in `payment/actions.ts`, because a `"use server"` file can only export
 * async functions.
 */
export const BACK_MONTHS = 12;
