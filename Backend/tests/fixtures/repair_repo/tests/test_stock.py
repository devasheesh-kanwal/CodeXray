from inventory.stock import top_sellers, total_units

SALES = {"apple": 5, "pear": 9, "plum": 2}


def test_top_sellers_returns_n_items():
    assert top_sellers(SALES, 2) == ["pear", "apple"]


def test_total_units():
    assert total_units(SALES) == 16
