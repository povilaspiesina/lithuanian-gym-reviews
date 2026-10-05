"""Build the initial, source-backed club directory for Google Maps matching."""

import json
import re
import unicodedata
from pathlib import Path


SOURCES = {
    "Gym+": "https://gymplius.lt/apie-mus/klubai/",
    "Lemon Gym": "https://www.lemongym.lt/klubai/",
    "SportGates": "https://sportgates.lt/kontaktai/",
}

# Gym+ IDs are from https://gymplius.lt/g-reviews/; other IDs were matched
# by address in Maps or the SportHub venue directory and rechecked in Maps.
VERIFIED_PLACE_IDS = {
    "gym-vilnius-ozo-g-18": "ChIJA69mNACR3UYROnIq-hPRZFI",
    "gym-vilnius-pavilnioniu-g-55": "ChIJ-ySBLwCR3UYRiIrziQgCfxc",
    "gym-vilnius-saltoniskiu-g-9": "ChIJZTJc8vuT3UYRjUR_a6tAtoE",
    "gym-klaipeda-h-manto-g-21": "ChIJh2ccd-Tb5EYRaCDU9DT9LQc",
    "gym-klaipeda-taikos-pr-61": "ChIJzRxQg57d5EYRD_J07-kTUu0",
    "gym-panevezys-smelynes-g-85-k1": "ChIJAzu6hmAz5kYRXykRlZTqxV0",
    # Matched by exact name and address in Google Maps search results.
    "lemon-gym-vilnius-ozo-g-25": "ChIJcxBUq4OR3UYRjdj_vzcqW1A",
    "lemon-gym-vilnius-konstitucijos-pr-7a": "ChIJ6RBa-QOU3UYRpnns_3PZu50",
    "lemon-gym-vilnius-perkunkiemio-g-4": "ChIJA1NsaaGR3UYRKHahOIhXXoo",
    "lemon-gym-kaunas-savanoriu-pr-168": "ChIJMUNvj98Z50YR2g6nzERbw-w",
    "sportgates-kaunas-a-sabaliausko-g-14": "ChIJ1dssKBwj50YRzVsyvcxFLes",
}

SEARCH_OVERRIDES = {
    # Gym+'s published link for this club currently opens its Vingio club in Klaipėda.
    "gym-panevezys-klaipedos-g-143a": "Gym Plius Babilonas, Klaipėdos g. 143A, Panevėžys",
}

# chain | club name | street address | locality | municipality | status
# Statuses reflect the labels on the official club pages on 2026-10-01.
ROWS = """Gym+|Mokslininkų|Mokslininkų g. 6A|Vilnius|Vilniaus miestas|open
Gym+|PC Europa|Konstitucijos pr. 7A-1|Vilnius|Vilniaus miestas|open
Gym+|Urban Hub Vilnius|Ožiarūčių g. 3|Vilnius|Vilniaus miestas|open
Gym+|Dariaus ir Girėno|Dariaus ir Girėno g. 2|Vilnius|Vilniaus miestas|open
Gym+|Gedimino|Gedimino pr. 9|Vilnius|Vilniaus miestas|open
Gym+|Kalvarijų|Kalvarijų g. 88|Vilnius|Vilniaus miestas|open
Gym+|Ozo|Ozo g. 18|Vilnius|Vilniaus miestas|open
Gym+|Pavilnionių|Pavilnionių g. 55|Vilnius|Vilniaus miestas|open
Gym+|Priegliaus|Priegliaus g. 1|Vilnius|Vilniaus miestas|open
Gym+|Savanorių Vilnius|Savanorių pr. 1|Vilnius|Vilniaus miestas|open
Gym+|Saltoniškių|Saltoniškių g. 9|Vilnius|Vilniaus miestas|open
Gym+|Ukmergės|Ukmergės g. 256|Vilnius|Vilniaus miestas|open
Gym+|Viršuliškių|Viršuliškių g. 40|Vilnius|Vilniaus miestas|renovating
Gym+|Vytauto Pociūno|Vytauto Pociūno g. 8|Vilnius|Vilniaus miestas|open
Gym+|Žemaitės|Žemaitės g. 22|Vilnius|Vilniaus miestas|open
Gym+|Žirmūnų|Žirmūnų g. 68A|Vilnius|Vilniaus miestas|open
Gym+|Europos|Europos pr. 70|Kaunas|Kauno miestas|coming_soon
Gym+|Savanorių Kaunas|Savanorių pr. 194|Kaunas|Kauno miestas|open
Gym+|Lyderystės|Lyderystės g. 8|Kaunas|Kauno miestas|open
Gym+|Baltų|Baltų pr. 49F|Kaunas|Kauno miestas|open
Gym+|Pramonės|Pramonės pr. 25|Kaunas|Kauno miestas|open
Gym+|Islandijos|Islandijos pl. 32|Kaunas|Kauno miestas|open
Gym+|V. Krėvės|V. Krėvės pr. 13|Kaunas|Kauno miestas|open
Gym+|Taikos 139|Taikos pr. 139|Klaipėda|Klaipėdos miestas|open
Gym+|Bangų|Bangų g. 2|Klaipėda|Klaipėdos miestas|open
Gym+|H. Manto|H. Manto g. 21|Klaipėda|Klaipėdos miestas|open
Gym+|Akropolis Klaipėda|Taikos pr. 61|Klaipėda|Klaipėdos miestas|open
Gym+|Vingio|Vingio g. 31|Klaipėda|Klaipėdos miestas|open
Gym+|Arena Klaipėda|Taikos pr. 64|Klaipėda|Klaipėdos miestas|open
Gym+|Smėlynės|Smėlynės g. 85 K1|Panevėžys|Panevėžio miestas|open
Gym+|Klaipėdos|Klaipėdos g. 143A|Panevėžys|Panevėžio miestas|open
Gym+|Ukmergės Panevėžys|Ukmergės g. 18|Panevėžys|Panevėžio miestas|open
Gym+|Vairo|Vairo g. 2|Šiauliai|Šiaulių miestas|open
Gym+|Gardino|Gardino g. 3|Šiauliai|Šiaulių miestas|open
Gym+|Gumbinės|Gumbinės g. 33C|Šiauliai|Šiaulių miestas|open
Gym+|V. Kudirkos|V. Kudirkos g. 47A|Marijampolė|Marijampolės miestas|open
Gym+|M. Daukšos|M. Daukšos g. 26|Mažeikiai|Mažeikių miestas|open
Gym+|Jazminų|Jazminų g. 3|Alytus|Alytaus miestas|open
Gym+|J. Basanavičiaus|J. Basanavičiaus g. 80|Kėdainiai|Kėdainių miestas|open
Gym+|Taikos Palanga|Taikos g. 68A|Palanga|Palangos miestas|open
Gym+|Gėlių|Gėlių g. 2|Telšiai|Telšių miestas|open
Lemon Gym|Saulėtekis|Saulėtekio al. 17|Vilnius|Vilniaus miestas|coming_soon
Lemon Gym|Riešė|Molėtų g. 13|Didžioji Riešė|Vilniaus rajonas|open
Lemon Gym|Vilniaus Žalgiris|Žalgirio g. 92|Vilnius|Vilniaus miestas|open
Lemon Gym|Vilniaus Akropolis|Ozo g. 25|Vilnius|Vilniaus miestas|open
Lemon Gym|Pikas|Ukmergės g. 221|Vilnius|Vilniaus miestas|open
Lemon Gym|Asanavičiūtė|L. Asanavičiūtės g. 15|Vilnius|Vilniaus miestas|open
Lemon Gym|Skraja|Naugarduko g. 55A|Vilnius|Vilniaus miestas|open
Lemon Gym|Vienuolis|Vienuolio g. 4|Vilnius|Vilniaus miestas|open
Lemon Gym|Pilaitė|Vydūno g. 2|Vilnius|Vilniaus miestas|open
Lemon Gym|Europa|Konstitucijos pr. 7A|Vilnius|Vilniaus miestas|open
Lemon Gym|Banginis|P. Lukšio g. 34|Vilnius|Vilniaus miestas|open
Lemon Gym|Antakalnis|Antakalnio g. 37|Vilnius|Vilniaus miestas|open
Lemon Gym|Ateities|Ateities g. 31B|Vilnius|Vilniaus miestas|open
Lemon Gym|Perkūnkiemis|Perkūnkiemio g. 4|Vilnius|Vilniaus miestas|open
Lemon Gym|Raudondvaris|Raudondvario pl. 169B|Kaunas|Kauno miestas|open
Lemon Gym|Urmas|Pramonės pr. 16|Kaunas|Kauno miestas|open
Lemon Gym|Šilainiai|Baltų pr. 16|Kaunas|Kauno miestas|open
Lemon Gym|Kauno Žalgirio arena|Karaliaus Mindaugo pr. 50|Kaunas|Kauno miestas|open
Lemon Gym|Savanoriai|Savanorių pr. 168|Kaunas|Kauno miestas|open
Lemon Gym|Šiaulių Akropolis|Aido g. 8|Šiauliai|Šiaulių miestas|open
SportGates|Žirmūnai|Verkių g. 31C|Vilnius|Vilniaus miestas|open
SportGates|Senamiestis|Mindaugo g. 14B|Vilnius|Vilniaus miestas|open
SportGates|Didžioji Riešė|Dangeručio g. 1|Didžioji Riešė|Vilniaus rajonas|open
SportGates|Fabijoniškės|S. Stanevičiaus g. 23|Vilnius|Vilniaus miestas|open
SportGates|Naujamiestis|Vytauto pr. 23|Kaunas|Kauno miestas|open
SportGates|Aleksotas|A. Sabaliausko g. 14|Kaunas|Kauno miestas|open
SportGates|Eiguliai|Šiaurės pr. 8D|Kaunas|Kauno miestas|open
SportGates|Dainava|V. Krėvės pr. 57|Kaunas|Kauno miestas|open
SportGates|Jūrininkai|Taikos pr. 141|Klaipėda|Klaipėdos miestas|open
SportGates|Liepų parkas|Liepų g. 80|Klaipėda|Klaipėdos miestas|coming_soon
SportGates|Centras Panevėžys|Respublikos g. 47A|Panevėžys|Panevėžio miestas|open"""


def slug(value):
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


clubs = []
for row in ROWS.splitlines():
    chain, name, street, locality, municipality, status = row.split("|")
    clubs.append(
        {
            "id": slug(f"{chain}-{locality}-{street}"),
            "chain": chain,
            "club_name": name,
            "street_address": street,
            "locality": locality,
            "municipality": municipality,
            "country_code": "LT",
            "status": status,
            "official_source_url": SOURCES[chain],
            "google_maps_search_query": SEARCH_OVERRIDES.get(
                slug(f"{chain}-{locality}-{street}"),
                f"{chain} {name}, {street}, {locality}, Lithuania",
            ),
            "google_place_id": VERIFIED_PLACE_IDS.get(slug(f"{chain}-{locality}-{street}")),
        }
    )

assert len(clubs) == 72
assert len({club["id"] for club in clubs}) == len(clubs)

output = {
    "as_of_date": "2026-10-01",
    "status_definitions": {
        "open": "Listed as operating on the official club page",
        "renovating": "Official page says ATSINAUJINA (renovating); current access needs checking",
        "coming_soon": "Official page says JAU GREITAI or gives a future opening month",
    },
    "clubs": clubs,
}
Path(__file__).with_name("gyms_lt.json").write_text(
    json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
