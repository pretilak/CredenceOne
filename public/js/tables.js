//============ enableTableFilter =================

function enableTableFilter(
    inputSelector,
    rowSelector
) {

    const filterInput =
        document.querySelector(
            inputSelector
        );

    if (!filterInput) return;

    filterInput.addEventListener(
        'input',
        function () {

            const filter =
                this.value
                    .toLowerCase()
                    .trim();

            document
                .querySelectorAll(
                    rowSelector
                )
                .forEach(row => {

                    const text =
                        row.innerText
                            .toLowerCase();

                    row.style.display =
                        text.includes(filter)
                            ? ''
                            : 'none';

                });

        }
    );
}


//=============== enableTableSorting ==================

function enableTableSorting(tableSelector) {

    const table =
        document.querySelector(
            tableSelector
        );

    if (!table) return;

    const headers =
        table.querySelectorAll(
            '.sortable'
        );

    headers.forEach(
        (header, index) => {

            header.addEventListener(
                'click',
                () => {

                    sortTable(
                        table,
                        index,
                        header
                    );

                }
            );

        }
    );
}

//================ sortTable ===================

function sortTable(
    table,
    colIndex,
    clickedHeader
) {

    const tbody =
        table.querySelector(
            'tbody'
        );

    const rows =
        Array.from(
            tbody.querySelectorAll('tr')
        );

    const ascending =
        clickedHeader.dataset.sort !==
        'asc';

    rows.sort((a, b) => {

        const aValue =
            a.children[colIndex]
                .innerText
                .trim()
                .toLowerCase();

        const bValue =
            b.children[colIndex]
                .innerText
                .trim()
                .toLowerCase();

        return ascending
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);

    });

    rows.forEach(
        row =>
            tbody.appendChild(row)
    );

    table
        .querySelectorAll('.sortable')
        .forEach(h => {
            h.dataset.sort = '';
        });

    clickedHeader.dataset.sort =
        ascending
            ? 'asc'
            : 'desc';
}

function initTablePage() {

    if (
        typeof scrollToUpdatedRow ===
        'function'
    ) {

        setTimeout(
            scrollToUpdatedRow,
            100
        );

    }

}


