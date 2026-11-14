"""Typed request contracts for the tuition/billing API (FIN-11).

Every money surface used to read raw JSON with `isinstance(..., int)` checks scattered across
routes. That leaves three real holes:

* ``True`` is an ``int`` in Python, so ``amountMinor: true`` was accepted as 1;
* a float rounds silently somewhere downstream, so ``1.5`` could become a charge;
* a period like ``2026-13`` or ``11-2026`` reached the ledger as a seven-character string and
  only failed later, if at all.

These models reject all three at the boundary with one consistent 422 shape, and they are the
only place that decides what a valid financial input is - routes no longer hand-roll it.

Nothing here authorizes anything. Roles, separation of duties and period/day locks stay in
:mod:`app.tuition_ledger`, because they must hold for a scheduler or an import job exactly as
they do for a browser.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from .tuition_ledger import business_date
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, Strict, field_validator

PERIOD_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')
METHODS = ('cash', 'bank', 'provider')

#: A receipt may be entered for today or yesterday without special permission: closing the
#: till at midnight is normal. Anything older is a backdated financial record and needs an
#: owner, so the grace window is one day, not "whatever the client sent".
BACKDATE_GRACE_DAYS = 1


class ValidationError(Exception):
    """One 422-shaped failure: the error code plus the fields that caused it."""

    def __init__(self, fields: list[dict]):
        super().__init__('invalid_payload')
        self.fields = fields

    def as_body(self) -> dict:
        return {'error': 'invalid_payload', 'fields': self.fields}


def parse(model: type[BaseModel], body: Any):
    """Validate `body` against `model`, raising :class:`ValidationError` with field detail."""
    if not isinstance(body, dict):
        raise ValidationError([{'field': '', 'message': 'a JSON object is required'}])
    try:
        return model.model_validate(body)
    except Exception as exc:  # pydantic's own error type is not worth coupling to
        fields = []
        for error in getattr(exc, 'errors', lambda: [])():
            fields.append({'field': '.'.join(str(part) for part in error.get('loc', ())) or '',
                           'message': str(error.get('msg', 'invalid'))})
        raise ValidationError(fields or [{'field': '', 'message': str(exc)}]) from exc


#: Money is a whole number of minor units, in STRICT mode. Pydantic's default lax mode
#: coerces `'800000'` -> 800000, `True` -> 1 and `800000.0` -> 800000, all of which would
#: become a real charge. Strict() refuses all three before any validator runs.
MoneyMinor = Annotated[int, Strict()]


class _Strict(BaseModel):
    """Unknown keys are refused: a typo in a money field must not be silently ignored."""

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ContractCreate(_Strict):
    studentUserId: UUID
    monthlyAmountMinor: MoneyMinor
    startsOn: date
    termMonths: int = 1
    courseId: UUID | None = None
    endsOn: date | None = None
    note: str | None = Field(default=None, max_length=300)

    @field_validator('monthlyAmountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value <= 0:
            raise ValueError('monthlyAmountMinor must be positive')
        return value

    @field_validator('termMonths')
    @classmethod
    def _term_is_sane(cls, value):
        if not 1 <= value <= 120:
            raise ValueError('termMonths must be between 1 and 120')
        return value


class DiscountCreate(_Strict):
    periodKey: str
    amountMinor: MoneyMinor
    reason: str = Field(min_length=1, max_length=200)

    @field_validator('amountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value <= 0:
            raise ValueError('amountMinor must be positive')
        return value

    @field_validator('periodKey')
    @classmethod
    def _period_is_yyyy_mm(cls, value):
        if not PERIOD_RE.match(value):
            raise ValueError('periodKey must be YYYY-MM')
        return value


class ChargeCreate(_Strict):
    studentUserId: UUID
    periodKey: str
    dueDate: date
    grossAmountMinor: MoneyMinor
    contractId: UUID | None = None
    #: Required by the ledger when grossAmountMinor differs from the approved contract price.
    adjustmentReason: str | None = Field(default=None, max_length=300)

    @field_validator('grossAmountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value < 0:
            raise ValueError('grossAmountMinor must not be negative')
        return value

    @field_validator('periodKey')
    @classmethod
    def _period_is_yyyy_mm(cls, value):
        if not PERIOD_RE.match(value):
            raise ValueError('periodKey must be YYYY-MM')
        return value


class InstallmentCreate(_Strict):
    dueDate: date
    periodKey: str | None = None

    @field_validator('periodKey')
    @classmethod
    def _period_is_yyyy_mm(cls, value):
        if value is not None and not PERIOD_RE.match(value):
            raise ValueError('periodKey must be YYYY-MM')
        return value


class CreditNoteCreate(_Strict):
    chargeId: UUID
    amountMinor: int
    reason: str = Field(min_length=1, max_length=300)

    @field_validator('amountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value <= 0:
            raise ValueError('amountMinor must be positive')
        return value


class PaymentCreate(_Strict):
    studentUserId: UUID
    amountMinor: int
    method: str = 'cash'
    provider: str | None = Field(default=None, max_length=20)
    providerTransactionId: str | None = Field(default=None, max_length=80)
    idempotencyKey: str | None = Field(default=None, max_length=120)
    receiptPurpose: str | None = Field(default=None, max_length=120)
    payerName: str | None = Field(default=None, max_length=160)
    #: The client may state when money changed hands; whether it may state a PAST date is
    #: decided by the caller's role, not by this model.
    occurredAt: datetime | None = None
    confirm: bool = True

    @field_validator('amountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value <= 0:
            raise ValueError('amountMinor must be positive')
        return value

    @field_validator('method')
    @classmethod
    def _method_is_known(cls, value):
        if value not in METHODS:
            raise ValueError(f'method must be one of {", ".join(METHODS)}')
        return value

    @field_validator('occurredAt')
    @classmethod
    def _occurred_at_is_not_in_the_future(cls, value):
        if value is None:
            return value
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if moment > datetime.now(timezone.utc) + timedelta(hours=1):
            raise ValueError('occurredAt cannot be in the future')
        return moment


class RevenueRecognize(_Strict):
    studentUserId: UUID
    amountMinor: int
    periodKey: str | None = None
    memo: str | None = Field(default=None, max_length=300)

    @field_validator('amountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value <= 0:
            raise ValueError('amountMinor must be positive')
        return value

    @field_validator('periodKey')
    @classmethod
    def _period_is_yyyy_mm(cls, value):
        if value is not None and not PERIOD_RE.match(value):
            raise ValueError('periodKey must be YYYY-MM')
        return value


class DayClose(_Strict):
    businessDate: date
    countedMinor: MoneyMinor
    openingMinor: MoneyMinor = 0
    reason: str | None = Field(default=None, max_length=300)

    @field_validator('countedMinor', 'openingMinor')
    @classmethod
    def _not_negative(cls, value):
        if value < 0:
            raise ValueError('must not be negative')
        return value


class CashAdjustment(_Strict):
    amountMinor: int
    reason: str = Field(min_length=1, max_length=300)

    @field_validator('amountMinor')
    @classmethod
    def _money_is_not_zero(cls, value):
        if value == 0:
            raise ValueError('amountMinor must not be zero')
        return value


class RefundRequest(_Strict):
    amountMinor: int
    reason: str = Field(min_length=1, max_length=200)
    method: str | None = None
    providerRefundId: str | None = Field(default=None, max_length=80)

    @field_validator('amountMinor')
    @classmethod
    def _money_is_positive(cls, value):
        if value <= 0:
            raise ValueError('amountMinor must be positive')
        return value

    @field_validator('method')
    @classmethod
    def _method_is_known(cls, value):
        if value is not None and value not in METHODS:
            raise ValueError(f'method must be one of {", ".join(METHODS)}')
        return value


class PeriodClose(_Strict):
    periodKey: str
    reason: str | None = Field(default=None, max_length=300)

    @field_validator('periodKey')
    @classmethod
    def _period_is_yyyy_mm(cls, value):
        if not PERIOD_RE.match(value):
            raise ValueError('periodKey must be YYYY-MM')
        return value


class ReasonOnly(_Strict):
    reason: str = Field(min_length=1, max_length=300)


def backdate_days(moment: datetime | None) -> int:
    """How many days in the past a client-supplied timestamp is (0 for today or absent)."""
    if moment is None:
        return 0
    delta = business_date(datetime.now(timezone.utc)) - business_date(moment)
    return max(delta.days, 0)
