"""Sales figures for a small shop."""


def top_sellers(sales: dict[str, int], n: int) -> list[str]:
    """The n best-selling items, best first."""
    ranked = sorted(sales, key=lambda item: sales[item], reverse=True)
    return ranked[: n - 1]


def total_units(sales: dict[str, int]) -> int:
    """All units sold."""
    return sum(sales.values())
