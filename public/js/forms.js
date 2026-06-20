    function enableSaveOnChange(form, extraValidationFn =() => true) {

        const saveBtn = form.querySelector('#saveBtn');

        function getFormState() {
            const data = {};

            form.querySelectorAll('input, select, textarea').forEach(el => {
                if (!el.name) return;

                if (el.type === 'checkbox') {
                    data[el.name] = el.checked;
                } else {
                    data[el.name] = el.value;
                }
            });

            return data;
        }

        const initialState = getFormState();

        function hasChanged() {
            const currentState = getFormState();
            //console.log("Current State:", currentState);
            return Object.keys(initialState).some(key =>
                initialState[key] !== currentState[key]
            );
        }

        function isFormValid() {

            // Validate required fields first
            if (!form.checkValidity()) {
                return false;
            }

            // Additional dynamic validation
            const currency =
                form.querySelector('[name="currency_code"]');

            if (
                currency &&
                !currency.disabled &&
                !currency.value
            ) {
                return false;
            }

            return true;
        }

        function updateButton() {
            
            const allRequiredFieldsFilled = hasChanged() && isFormValid();
            saveBtn.disabled = !allRequiredFieldsFilled || !passwordsMatch() || !extraValidationFn();
        }

        form.addEventListener('input', updateButton);
        form.addEventListener('change', updateButton);

        updateButton();

        return updateButton;
    }

    //helper function
    function passwordsMatch() {

        const password =
            document.getElementById('password');

        const confirmPassword =
            document.getElementById('confirmPassword');

        if (!password || !confirmPassword) {
            return true;
        }

        return (
            password.value.length > 0 &&
            password.value === confirmPassword.value
        );
    }